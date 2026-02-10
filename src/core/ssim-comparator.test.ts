import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { SSIMComparator } from './ssim-comparator.js';

function createSolidPNG(width: number, height: number, r: number, g: number, b: number): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function createGradientPNG(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const val = Math.floor((x / width) * 255);
      png.data[idx] = val;
      png.data[idx + 1] = val;
      png.data[idx + 2] = val;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

describe('SSIMComparator', () => {
  const comparator = new SSIMComparator();

  it('identical images have SSIM = 1.0', () => {
    const img = createSolidPNG(64, 64, 128, 128, 128);
    const result = comparator.compare(img, img);
    expect(result.ssim).toBeCloseTo(1.0, 4);
  });

  it('very different images have low SSIM', () => {
    const white = createSolidPNG(64, 64, 255, 255, 255);
    const black = createSolidPNG(64, 64, 0, 0, 0);
    const result = comparator.compare(white, black);
    expect(result.ssim).toBeLessThan(0.1);
  });

  it('similar images have high SSIM', () => {
    const imgA = createSolidPNG(64, 64, 128, 128, 128);
    const imgB = createSolidPNG(64, 64, 130, 130, 130); // slight diff
    const result = comparator.compare(imgA, imgB);
    expect(result.ssim).toBeGreaterThan(0.95);
  });

  it('gradient vs solid has moderate SSIM', () => {
    const gradient = createGradientPNG(64, 64);
    const solid = createSolidPNG(64, 64, 128, 128, 128);
    const result = comparator.compare(gradient, solid);
    expect(result.ssim).toBeGreaterThan(0.0);
    expect(result.ssim).toBeLessThan(0.9);
  });

  it('throws on dimension mismatch', () => {
    const a = createSolidPNG(64, 64, 128, 128, 128);
    const b = createSolidPNG(32, 32, 128, 128, 128);
    expect(() => comparator.compare(a, b)).toThrow(/dimensions/i);
  });

  it('custom window size works', () => {
    const img = createSolidPNG(32, 32, 100, 100, 100);
    const result = comparator.compare(img, img, { windowSize: 7 });
    expect(result.ssim).toBeCloseTo(1.0, 4);
  });
});
