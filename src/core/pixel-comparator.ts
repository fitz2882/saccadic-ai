/**
 * Pixel-level comparison using pixelmatch and CIEDE2000 color distance.
 */

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { PixelDiffResult, DiffRegion, Severity, THRESHOLDS } from './types.js';

export interface PixelCompareOptions {
  /** Threshold for pixelmatch (0-1), default 0.1 */
  threshold?: number;
  /** Include anti-aliased pixels in diff, default false */
  includeAA?: boolean;
  /** Alpha threshold (0-1), default 0.1 */
  alpha?: number;
  /** Diff mask color [R, G, B] array, default pink */
  diffColor?: [number, number, number];
  /** Minimum region size in pixels to report, default 4 */
  minRegionSize?: number;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface Lab {
  L: number;
  a: number;
  b: number;
}

/**
 * PixelComparator: performs pixel-level image comparison with CIEDE2000 color science.
 */
export class PixelComparator {
  /**
   * Compare two PNG images pixel by pixel using pixelmatch.
   */
  compare(imageA: Buffer, imageB: Buffer, options: PixelCompareOptions = {}): PixelDiffResult {
    const {
      threshold = 0.1,
      includeAA = false,
      alpha = 0.1,
      diffColor = [255, 0, 255],
    } = options;

    // Decode PNG images
    const pngA = PNG.sync.read(imageA);
    const pngB = PNG.sync.read(imageB);

    // Ensure dimensions match
    if (pngA.width !== pngB.width || pngA.height !== pngB.height) {
      throw new Error(
        `Image dimensions do not match: A(${pngA.width}x${pngA.height}) vs B(${pngB.width}x${pngB.height})`
      );
    }

    const { width, height } = pngA;
    const totalPixels = width * height;

    // Create diff image
    const diff = new PNG({ width, height });

    // Run pixelmatch
    const diffPixels = pixelmatch(
      pngA.data,
      pngB.data,
      diff.data,
      width,
      height,
      {
        threshold,
        includeAA,
        alpha,
        diffColor,
      }
    );

    const diffPercentage = (diffPixels / totalPixels) * 100;

    // Encode diff image back to buffer
    const diffBuffer = PNG.sync.write(diff);

    return {
      totalPixels,
      diffPixels,
      diffPercentage,
      diffImage: diffBuffer,
    };
  }

  /**
   * Compute CIEDE2000 color distance between two hex colors.
   * Returns ΔE₀₀ value (0 = identical, >2.3 = noticeable difference).
   */
  computeDeltaE(colorA: string, colorB: string): number {
    const rgbA = this.hexToRgb(colorA);
    const rgbB = this.hexToRgb(colorB);

    const labA = this.rgbToLab(rgbA);
    const labB = this.rgbToLab(rgbB);

    return this.labToDeltaE2000(labA, labB);
  }

  /**
   * Find contiguous diff regions using connected component analysis.
   */
  findDiffRegions(diffImage: Buffer, width: number, height: number): DiffRegion[] {
    const png = PNG.sync.read(diffImage);
    const visited = new Set<number>();
    const regions: DiffRegion[] = [];

    // Helper to check if pixel is "different" in the pixelmatch diff image.
    // Diff pixels have the diffColor (non-zero RGB) at full alpha.
    // Non-diff pixels are either low-alpha or black.
    const isDiff = (x: number, y: number): boolean => {
      const idx = (y * width + x) * 4;
      const hasColor = png.data[idx] > 0 || png.data[idx + 1] > 0 || png.data[idx + 2] > 0;
      const hasAlpha = png.data[idx + 3] > 128;
      return hasColor && hasAlpha;
    };

    // Flood fill to find connected component
    const floodFill = (startX: number, startY: number): DiffRegion | null => {
      const stack: Array<[number, number]> = [[startX, startY]];
      let minX = startX;
      let maxX = startX;
      let minY = startY;
      let maxY = startY;
      let pixelCount = 0;

      while (stack.length > 0) {
        const [x, y] = stack.pop()!;
        const idx = y * width + x;

        if (visited.has(idx)) continue;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        if (!isDiff(x, y)) continue;

        visited.add(idx);
        pixelCount++;

        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);

        // Add neighbors to stack
        stack.push([x + 1, y]);
        stack.push([x - 1, y]);
        stack.push([x, y + 1]);
        stack.push([x, y - 1]);
      }

      if (pixelCount === 0) return null;

      return {
        bounds: {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        },
        severity: 'warn' as Severity,
        type: 'rendering',
        description: `Diff region of ${pixelCount} pixels`,
      };
    };

    // Scan all pixels
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (visited.has(idx)) continue;
        if (!isDiff(x, y)) continue;

        const region = floodFill(x, y);
        if (region) {
          const area = region.bounds.width * region.bounds.height;
          // Filter out tiny regions (noise)
          if (area >= 4) {
            regions.push(region);
          }
        }
      }
    }

    return regions;
  }

  /**
   * Classify a diff region's severity based on size and type.
   */
  classifyRegion(region: DiffRegion, totalArea: number): DiffRegion {
    const regionArea = region.bounds.width * region.bounds.height;
    const areaPercentage = regionArea / totalArea;

    // Classify based on area percentage
    let severity: Severity;
    if (areaPercentage < THRESHOLDS.pixel.pass) {
      severity = 'pass';
    } else if (areaPercentage < THRESHOLDS.pixel.warn) {
      severity = 'warn';
    } else {
      severity = 'fail';
    }

    return {
      ...region,
      severity,
    };
  }

  /**
   * Map CIEDE2000 ΔE value to severity level.
   */
  severityFromDeltaE(deltaE: number): Severity {
    if (deltaE < THRESHOLDS.color.pass) {
      return 'pass';
    } else if (deltaE < THRESHOLDS.color.warn) {
      return 'warn';
    } else {
      return 'fail';
    }
  }

  // ── Color Conversion Utilities ──

  /**
   * Convert hex color to RGB.
   */
  private hexToRgb(hex: string): RGB {
    // Remove # if present
    hex = hex.replace(/^#/, '');

    // Handle 3-digit hex
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('');
    }

    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    return { r, g, b };
  }

  /**
   * Convert RGB to CIELAB via sRGB → XYZ → LAB.
   */
  private rgbToLab(rgb: RGB): Lab {
    // sRGB to linear RGB
    const toLinear = (channel: number): number => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };

    const rLinear = toLinear(rgb.r);
    const gLinear = toLinear(rgb.g);
    const bLinear = toLinear(rgb.b);

    // Linear RGB to XYZ (D65 illuminant)
    let x = rLinear * 0.4124564 + gLinear * 0.3575761 + bLinear * 0.1804375;
    let y = rLinear * 0.2126729 + gLinear * 0.7151522 + bLinear * 0.072175;
    let z = rLinear * 0.0193339 + gLinear * 0.119192 + bLinear * 0.9503041;

    // Normalize to D65 white point
    x = (x / 0.95047) * 100;
    y = (y / 1.0) * 100;
    z = (z / 1.08883) * 100;

    // XYZ to LAB
    const labF = (t: number): number => {
      return t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116;
    };

    const fx = labF(x / 100);
    const fy = labF(y / 100);
    const fz = labF(z / 100);

    const L = 116 * fy - 16;
    const a = 500 * (fx - fy);
    const b = 200 * (fy - fz);

    return { L, a, b };
  }

  /**
   * Compute CIEDE2000 color distance between two LAB colors.
   * Simplified implementation with kL=kC=kH=1.
   */
  private labToDeltaE2000(lab1: Lab, lab2: Lab): number {
    const { L: L1, a: a1, b: b1 } = lab1;
    const { L: L2, a: a2, b: b2 } = lab2;

    // Mean L
    const Lmean = (L1 + L2) / 2;

    // Chroma
    const C1 = Math.sqrt(a1 * a1 + b1 * b1);
    const C2 = Math.sqrt(a2 * a2 + b2 * b2);
    const Cmean = (C1 + C2) / 2;

    // G factor for a' adjustment
    const G = 0.5 * (1 - Math.sqrt(Math.pow(Cmean, 7) / (Math.pow(Cmean, 7) + Math.pow(25, 7))));

    // Adjusted a'
    const a1Prime = a1 * (1 + G);
    const a2Prime = a2 * (1 + G);

    // Adjusted chroma
    const C1Prime = Math.sqrt(a1Prime * a1Prime + b1 * b1);
    const C2Prime = Math.sqrt(a2Prime * a2Prime + b2 * b2);
    const CmeanPrime = (C1Prime + C2Prime) / 2;

    // Hue
    const h1Prime = this.computeHue(a1Prime, b1);
    const h2Prime = this.computeHue(a2Prime, b2);

    // Hue difference
    let dhPrime = 0;
    if (C1Prime * C2Prime !== 0) {
      dhPrime = h2Prime - h1Prime;
      if (dhPrime > 180) dhPrime -= 360;
      else if (dhPrime < -180) dhPrime += 360;
    }

    // Mean hue
    let HmeanPrime = 0;
    if (C1Prime * C2Prime !== 0) {
      HmeanPrime = (h1Prime + h2Prime) / 2;
      if (Math.abs(h1Prime - h2Prime) > 180) {
        if (HmeanPrime < 180) HmeanPrime += 180;
        else HmeanPrime -= 180;
      }
    }

    // Differences
    const dL = L2 - L1;
    const dC = C2Prime - C1Prime;
    const dH = 2 * Math.sqrt(C1Prime * C2Prime) * Math.sin((dhPrime * Math.PI) / 360);

    // Weighting factors
    const T =
      1 -
      0.17 * Math.cos(((HmeanPrime - 30) * Math.PI) / 180) +
      0.24 * Math.cos((2 * HmeanPrime * Math.PI) / 180) +
      0.32 * Math.cos(((3 * HmeanPrime + 6) * Math.PI) / 180) -
      0.2 * Math.cos(((4 * HmeanPrime - 63) * Math.PI) / 180);

    const SL = 1 + (0.015 * Math.pow(Lmean - 50, 2)) / Math.sqrt(20 + Math.pow(Lmean - 50, 2));
    const SC = 1 + 0.045 * CmeanPrime;
    const SH = 1 + 0.015 * CmeanPrime * T;

    // Rotation term
    const dTheta = 30 * Math.exp(-Math.pow((HmeanPrime - 275) / 25, 2));
    const RC = 2 * Math.sqrt(Math.pow(CmeanPrime, 7) / (Math.pow(CmeanPrime, 7) + Math.pow(25, 7)));
    const RT = -RC * Math.sin((2 * dTheta * Math.PI) / 180);

    // Final ΔE₀₀ with kL=kC=kH=1
    const deltaE = Math.sqrt(
      Math.pow(dL / SL, 2) +
        Math.pow(dC / SC, 2) +
        Math.pow(dH / SH, 2) +
        RT * (dC / SC) * (dH / SH)
    );

    return deltaE;
  }

  /**
   * Compute hue angle in degrees from a' and b.
   */
  private computeHue(aPrime: number, b: number): number {
    if (aPrime === 0 && b === 0) return 0;
    let h = (Math.atan2(b, aPrime) * 180) / Math.PI;
    if (h < 0) h += 360;
    return h;
  }
}
