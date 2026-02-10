/**
 * SSIM Comparator - Structural Similarity Index in pure TypeScript.
 *
 * Computes SSIM between two PNG images using a sliding window approach.
 * SSIM measures perceptual quality: luminance, contrast, and structure.
 */

import { PNG } from 'pngjs';
import type { MLMetrics } from './types.js';

const DEFAULT_WINDOW_SIZE = 11;
const K1 = 0.01;
const K2 = 0.03;
const L = 255; // dynamic range for 8-bit images

export interface SSIMOptions {
  windowSize?: number;
}

export class SSIMComparator {
  /**
   * Compute SSIM between two PNG buffers.
   */
  compare(imageA: Buffer, imageB: Buffer, options?: SSIMOptions): MLMetrics {
    const pngA = PNG.sync.read(imageA);
    const pngB = PNG.sync.read(imageB);

    if (pngA.width !== pngB.width || pngA.height !== pngB.height) {
      throw new Error(
        `Image dimensions don't match: ${pngA.width}x${pngA.height} vs ${pngB.width}x${pngB.height}`
      );
    }

    const grayA = this.toGrayscale(pngA.data, pngA.width, pngA.height);
    const grayB = this.toGrayscale(pngB.data, pngB.width, pngB.height);

    const windowSize = options?.windowSize ?? DEFAULT_WINDOW_SIZE;
    const ssim = this.computeSSIM(grayA, grayB, pngA.width, pngA.height, windowSize);

    return { ssim };
  }

  /**
   * Convert RGBA buffer to grayscale float array (0-255).
   */
  private toGrayscale(data: Buffer, width: number, height: number): Float64Array {
    const gray = new Float64Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const offset = i * 4;
      // ITU-R BT.601 luma
      gray[i] = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
    }
    return gray;
  }

  /**
   * Compute SSIM with sliding window.
   */
  private computeSSIM(
    imgA: Float64Array,
    imgB: Float64Array,
    width: number,
    height: number,
    windowSize: number
  ): number {
    const c1 = (K1 * L) ** 2;
    const c2 = (K2 * L) ** 2;
    const halfWindow = Math.floor(windowSize / 2);

    let ssimSum = 0;
    let count = 0;

    // Slide window across image, stepping by 1
    for (let y = halfWindow; y < height - halfWindow; y++) {
      for (let x = halfWindow; x < width - halfWindow; x++) {
        let sumA = 0;
        let sumB = 0;
        let sumA2 = 0;
        let sumB2 = 0;
        let sumAB = 0;
        let n = 0;

        for (let wy = -halfWindow; wy <= halfWindow; wy++) {
          for (let wx = -halfWindow; wx <= halfWindow; wx++) {
            const idx = (y + wy) * width + (x + wx);
            const a = imgA[idx];
            const b = imgB[idx];
            sumA += a;
            sumB += b;
            sumA2 += a * a;
            sumB2 += b * b;
            sumAB += a * b;
            n++;
          }
        }

        const muA = sumA / n;
        const muB = sumB / n;
        const sigmaA2 = sumA2 / n - muA * muA;
        const sigmaB2 = sumB2 / n - muB * muB;
        const sigmaAB = sumAB / n - muA * muB;

        const numerator = (2 * muA * muB + c1) * (2 * sigmaAB + c2);
        const denominator = (muA * muA + muB * muB + c1) * (sigmaA2 + sigmaB2 + c2);

        if (denominator > 0) {
          ssimSum += numerator / denominator;
        } else {
          ssimSum += 1.0; // identical regions
        }
        count++;
      }
    }

    return count > 0 ? ssimSum / count : 1;
  }
}
