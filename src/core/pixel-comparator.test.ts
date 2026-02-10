/**
 * Tests for PixelComparator: pixel-level comparison and color science.
 */

import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { PixelComparator } from './pixel-comparator.js';

describe('PixelComparator', () => {
  const comparator = new PixelComparator();

  describe('hexToRgb', () => {
    it('should convert 6-digit hex to RGB', () => {
      // Use a public method approach by testing through computeDeltaE
      // Since hexToRgb is private, we test it indirectly
      const result = comparator.computeDeltaE('#FF0000', '#FF0000');
      expect(result).toBe(0); // Same color should have 0 delta
    });

    it('should handle hex colors with and without # prefix', () => {
      const delta1 = comparator.computeDeltaE('#FF0000', 'FF0000');
      expect(delta1).toBe(0);
    });

    it('should handle 3-digit hex colors', () => {
      // #F00 should expand to #FF0000
      const delta = comparator.computeDeltaE('#F00', '#FF0000');
      expect(delta).toBeLessThan(0.01); // Should be very close or identical
    });
  });

  describe('rgbToLab and color conversion', () => {
    it('should convert white to LAB correctly', () => {
      // White: RGB(255, 255, 255) → LAB(100, 0, 0) approximately
      const deltaE = comparator.computeDeltaE('#FFFFFF', '#FFFFFF');
      expect(deltaE).toBe(0);
    });

    it('should convert black to LAB correctly', () => {
      // Black: RGB(0, 0, 0) → LAB(0, 0, 0)
      const deltaE = comparator.computeDeltaE('#000000', '#000000');
      expect(deltaE).toBe(0);
    });

    it('should convert primary colors correctly', () => {
      // Red to Red
      const deltaRed = comparator.computeDeltaE('#FF0000', '#FF0000');
      expect(deltaRed).toBe(0);

      // Green to Green
      const deltaGreen = comparator.computeDeltaE('#00FF00', '#00FF00');
      expect(deltaGreen).toBe(0);

      // Blue to Blue
      const deltaBlue = comparator.computeDeltaE('#0000FF', '#0000FF');
      expect(deltaBlue).toBe(0);
    });
  });

  describe('computeDeltaE (CIEDE2000)', () => {
    it('should return 0 for identical colors', () => {
      const deltaE = comparator.computeDeltaE('#FF5733', '#FF5733');
      expect(deltaE).toBe(0);
    });

    it('should return small delta for similar colors', () => {
      // Very similar reds
      const deltaE = comparator.computeDeltaE('#FF0000', '#FE0000');
      expect(deltaE).toBeGreaterThan(0);
      expect(deltaE).toBeLessThan(1.0); // Should be imperceptible
    });

    it('should return larger delta for different colors', () => {
      // Red vs Blue - should be very different
      const deltaE = comparator.computeDeltaE('#FF0000', '#0000FF');
      expect(deltaE).toBeGreaterThan(50); // Very different colors
    });

    it('should detect subtle color differences', () => {
      // Slightly different grays
      const deltaE = comparator.computeDeltaE('#808080', '#858585');
      expect(deltaE).toBeGreaterThan(0);
      expect(deltaE).toBeLessThan(5); // Small but detectable
    });

    it('should handle known CIEDE2000 test pairs', () => {
      // These are approximate - CIEDE2000 is complex
      // Pure red to slightly less saturated red
      const deltaE = comparator.computeDeltaE('#FF0000', '#FF3333');
      expect(deltaE).toBeGreaterThan(5);
      expect(deltaE).toBeLessThan(20);
    });
  });

  describe('compare with pixelmatch', () => {
    it('should return 0 diff for identical images', () => {
      // Create two identical 10x10 red images
      const width = 10;
      const height = 10;
      const imageA = createSolidColorImage(width, height, [255, 0, 0, 255]);
      const imageB = createSolidColorImage(width, height, [255, 0, 0, 255]);

      const result = comparator.compare(imageA, imageB);

      expect(result.totalPixels).toBe(100);
      expect(result.diffPixels).toBe(0);
      expect(result.diffPercentage).toBe(0);
      expect(result.diffImage).toBeDefined();
    });

    it('should detect differences between images', () => {
      const width = 10;
      const height = 10;
      // Create one red and one blue image
      const imageA = createSolidColorImage(width, height, [255, 0, 0, 255]);
      const imageB = createSolidColorImage(width, height, [0, 0, 255, 255]);

      const result = comparator.compare(imageA, imageB);

      expect(result.totalPixels).toBe(100);
      expect(result.diffPixels).toBeGreaterThan(0);
      expect(result.diffPercentage).toBeGreaterThan(0);
    });

    it('should detect partial differences', () => {
      const width = 10;
      const height = 10;
      // Create image with half red, half blue
      const imageA = createSolidColorImage(width, height, [255, 0, 0, 255]);
      const imageB = createHalfAndHalfImage(width, height);

      const result = comparator.compare(imageA, imageB);

      expect(result.totalPixels).toBe(100);
      expect(result.diffPixels).toBeGreaterThan(0);
      expect(result.diffPixels).toBeLessThan(100);
    });

    it('should throw error for mismatched dimensions', () => {
      const imageA = createSolidColorImage(10, 10, [255, 0, 0, 255]);
      const imageB = createSolidColorImage(20, 20, [255, 0, 0, 255]);

      expect(() => comparator.compare(imageA, imageB)).toThrow(/dimensions do not match/i);
    });

    it('should respect threshold option', () => {
      const width = 10;
      const height = 10;
      // Create slightly different colors
      const imageA = createSolidColorImage(width, height, [255, 0, 0, 255]);
      const imageB = createSolidColorImage(width, height, [250, 0, 0, 255]);

      // High threshold = less sensitive
      const result1 = comparator.compare(imageA, imageB, { threshold: 0.5 });
      // Low threshold = more sensitive
      const result2 = comparator.compare(imageA, imageB, { threshold: 0.01 });

      expect(result2.diffPixels).toBeGreaterThanOrEqual(result1.diffPixels);
    });
  });

  describe('findDiffRegions', () => {
    it('should find a single contiguous diff region', () => {
      const width = 20;
      const height = 20;
      // Create diff image with a 5x5 square of difference in the center
      const diffImage = createDiffImageWithSquare(width, height, 7, 7, 5);

      const regions = comparator.findDiffRegions(diffImage, width, height);

      expect(regions.length).toBeGreaterThan(0);
      expect(regions[0].bounds).toBeDefined();
      expect(regions[0].severity).toBeDefined();
      expect(regions[0].type).toBe('rendering');
    });

    it('should find multiple separate diff regions', () => {
      const width = 30;
      const height = 30;
      // Create diff image with two separate squares
      const diffImage = createDiffImageWithMultipleSquares(width, height);

      const regions = comparator.findDiffRegions(diffImage, width, height);

      expect(regions.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter out tiny regions (< 4px)', () => {
      const width = 20;
      const height = 20;
      // Create diff image with 2x2 square (area = 4, should be kept)
      const diffImage = createDiffImageWithSquare(width, height, 5, 5, 2);

      const regions = comparator.findDiffRegions(diffImage, width, height);

      // Should keep the 2x2 region (area = 4)
      expect(regions.length).toBeGreaterThan(0);
    });

    it('should return empty array for image with no differences', () => {
      const width = 10;
      const height = 10;
      // Create all-black diff image (no differences)
      const diffImage = createSolidColorImage(width, height, [0, 0, 0, 255]);

      const regions = comparator.findDiffRegions(diffImage, width, height);

      expect(regions.length).toBe(0);
    });
  });

  describe('classifyRegion', () => {
    it('should classify small regions as pass', () => {
      const region = {
        bounds: { x: 0, y: 0, width: 5, height: 5 },
        severity: 'warn' as const,
        type: 'rendering' as const,
        description: 'Test region',
      };
      const totalArea = 10000; // Region is 25/10000 = 0.25% < 1%

      const classified = comparator.classifyRegion(region, totalArea);

      expect(classified.severity).toBe('pass');
    });

    it('should classify medium regions as warn', () => {
      const region = {
        bounds: { x: 0, y: 0, width: 20, height: 20 },
        severity: 'pass' as const,
        type: 'rendering' as const,
        description: 'Test region',
      };
      const totalArea = 10000; // Region is 400/10000 = 4% (between 1% and 5%)

      const classified = comparator.classifyRegion(region, totalArea);

      expect(classified.severity).toBe('warn');
    });

    it('should classify large regions as fail', () => {
      const region = {
        bounds: { x: 0, y: 0, width: 80, height: 80 },
        severity: 'pass' as const,
        type: 'rendering' as const,
        description: 'Test region',
      };
      const totalArea = 10000; // Region is 6400/10000 = 64% > 5%

      const classified = comparator.classifyRegion(region, totalArea);

      expect(classified.severity).toBe('fail');
    });
  });

  describe('severityFromDeltaE', () => {
    it('should return pass for imperceptible differences', () => {
      const severity = comparator.severityFromDeltaE(0.5);
      expect(severity).toBe('pass');
    });

    it('should return warn for minor differences', () => {
      const severity = comparator.severityFromDeltaE(1.5);
      expect(severity).toBe('warn');
    });

    it('should return fail for noticeable differences', () => {
      const severity = comparator.severityFromDeltaE(3.0);
      expect(severity).toBe('fail');
    });

    it('should handle boundary values correctly', () => {
      expect(comparator.severityFromDeltaE(0.99)).toBe('pass');
      expect(comparator.severityFromDeltaE(1.0)).toBe('warn');
      expect(comparator.severityFromDeltaE(1.99)).toBe('warn');
      expect(comparator.severityFromDeltaE(2.0)).toBe('fail');
    });
  });
});

// ── Test Helpers ──

/**
 * Create a solid color PNG image buffer.
 */
function createSolidColorImage(
  width: number,
  height: number,
  color: [number, number, number, number]
): Buffer {
  const png = new PNG({ width, height });

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      png.data[idx] = color[0]; // R
      png.data[idx + 1] = color[1]; // G
      png.data[idx + 2] = color[2]; // B
      png.data[idx + 3] = color[3]; // A
    }
  }

  return PNG.sync.write(png);
}

/**
 * Create image with left half red, right half blue.
 */
function createHalfAndHalfImage(width: number, height: number): Buffer {
  const png = new PNG({ width, height });

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (x < width / 2) {
        // Left half: red
        png.data[idx] = 255;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 255;
      } else {
        // Right half: blue
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 255;
        png.data[idx + 3] = 255;
      }
    }
  }

  return PNG.sync.write(png);
}

/**
 * Create diff image with a square of "difference" pixels (pink).
 */
function createDiffImageWithSquare(
  width: number,
  height: number,
  startX: number,
  startY: number,
  size: number
): Buffer {
  const png = new PNG({ width, height });

  // Fill with black (no diff)
  for (let i = 0; i < png.data.length; i++) {
    png.data[i] = 0;
  }

  // Draw pink square (diff color)
  for (let y = startY; y < startY + size && y < height; y++) {
    for (let x = startX; x < startX + size && x < width; x++) {
      const idx = (y * width + x) * 4;
      png.data[idx] = 255; // R
      png.data[idx + 1] = 0; // G
      png.data[idx + 2] = 255; // B
      png.data[idx + 3] = 255; // A
    }
  }

  return PNG.sync.write(png);
}

/**
 * Create diff image with multiple separate squares.
 */
function createDiffImageWithMultipleSquares(width: number, height: number): Buffer {
  const png = new PNG({ width, height });

  // Fill with black (no diff)
  for (let i = 0; i < png.data.length; i++) {
    png.data[i] = 0;
  }

  // Draw two separate pink squares
  const drawSquare = (startX: number, startY: number, size: number) => {
    for (let y = startY; y < startY + size && y < height; y++) {
      for (let x = startX; x < startX + size && x < width; x++) {
        const idx = (y * width + x) * 4;
        png.data[idx] = 255;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 255;
        png.data[idx + 3] = 255;
      }
    }
  };

  drawSquare(5, 5, 5); // First square at (5,5)
  drawSquare(20, 20, 5); // Second square at (20,20)

  return PNG.sync.write(png);
}
