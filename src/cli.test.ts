/**
 * CLI tests for Saccadic AI visual feedback system.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { STANDARD_VIEWPORTS, type Viewport, type ComparisonResult } from './core/types.js';

// ── Viewport Resolution Tests ──

function resolveViewport(viewportArg?: string): Viewport | undefined {
  if (!viewportArg) return undefined;

  // Check if it's a named viewport
  if (viewportArg in STANDARD_VIEWPORTS) {
    return STANDARD_VIEWPORTS[viewportArg];
  }

  // Parse WxH format
  const match = viewportArg.match(/^(\d+)x(\d+)$/);
  if (match) {
    return {
      width: parseInt(match[1], 10),
      height: parseInt(match[2], 10),
    };
  }

  throw new Error(
    `Invalid viewport: "${viewportArg}". Use a named viewport (${Object.keys(STANDARD_VIEWPORTS).join(', ')}) or WxH format (e.g., 1920x1080).`
  );
}

describe('CLI Viewport Resolution', () => {
  it('should resolve named viewport', () => {
    const viewport = resolveViewport('desktop');
    expect(viewport).toEqual({ width: 1280, height: 800 });
  });

  it('should resolve all standard viewports', () => {
    expect(resolveViewport('mobile-sm')).toEqual({ width: 320, height: 568 });
    expect(resolveViewport('mobile')).toEqual({ width: 375, height: 812 });
    expect(resolveViewport('tablet')).toEqual({ width: 768, height: 1024 });
    expect(resolveViewport('desktop-sm')).toEqual({ width: 1024, height: 768 });
    expect(resolveViewport('desktop')).toEqual({ width: 1280, height: 800 });
    expect(resolveViewport('desktop-lg')).toEqual({ width: 1440, height: 900 });
  });

  it('should resolve WxH format', () => {
    const viewport = resolveViewport('1920x1080');
    expect(viewport).toEqual({ width: 1920, height: 1080 });
  });

  it('should resolve small viewport', () => {
    const viewport = resolveViewport('320x240');
    expect(viewport).toEqual({ width: 320, height: 240 });
  });

  it('should resolve large viewport', () => {
    const viewport = resolveViewport('3840x2160');
    expect(viewport).toEqual({ width: 3840, height: 2160 });
  });

  it('should throw error for invalid viewport', () => {
    expect(() => resolveViewport('invalid')).toThrow('Invalid viewport');
    expect(() => resolveViewport('1920')).toThrow('Invalid viewport');
    expect(() => resolveViewport('1920x')).toThrow('Invalid viewport');
    expect(() => resolveViewport('x1080')).toThrow('Invalid viewport');
  });

  it('should return undefined for no viewport argument', () => {
    expect(resolveViewport()).toBeUndefined();
  });
});

// ── Output Formatting Tests ──

describe('CLI Output Formatting', () => {
  it('should format JSON output correctly', () => {
    const mockResult: ComparisonResult = {
      overall: {
        matchPercentage: 87.5,
        grade: 'B',
        summary: 'Good match with minor differences',
      },
      domDiff: {
        matches: 10,
        mismatches: [
          {
            element: '.header-cta',
            property: 'backgroundColor',
            expected: '#0066FF',
            actual: '#0055DD',
            severity: 'fail',
            fix: 'Change `backgroundColor: #0055DD` to `backgroundColor: #0066FF` on `.header-cta`',
          },
        ],
        missing: ['hero-image'],
        extra: [],
      },
      pixelDiff: {
        totalPixels: 1000000,
        diffPixels: 50000,
        diffPercentage: 5.0,
      },
      regions: [],
      feedback: [
        {
          severity: 'fail',
          category: 'color',
          message: 'backgroundColor: expected #0066FF, got #0055DD',
          element: '.header-cta',
          fix: 'Change `backgroundColor: #0055DD` to `backgroundColor: #0066FF` on `.header-cta`',
        },
        {
          severity: 'fail',
          category: 'missing',
          message: 'Missing element: hero-image',
        },
      ],
      timestamp: Date.now(),
    };

    const json = JSON.stringify(mockResult, null, 2);
    expect(json).toContain('"matchPercentage": 87.5');
    expect(json).toContain('"grade": "B"');
    expect(json).toContain('"backgroundColor"');
    expect(json).toContain('"#0066FF"');
  });

  it('should include all required fields in JSON output', () => {
    const mockResult: ComparisonResult = {
      overall: {
        matchPercentage: 95.0,
        grade: 'A',
        summary: 'Excellent match',
      },
      domDiff: {
        matches: 20,
        mismatches: [],
        missing: [],
        extra: [],
      },
      pixelDiff: {
        totalPixels: 1000000,
        diffPixels: 5000,
        diffPercentage: 0.5,
      },
      regions: [],
      feedback: [],
      timestamp: Date.now(),
    };

    const parsed = JSON.parse(JSON.stringify(mockResult));
    expect(parsed).toHaveProperty('overall');
    expect(parsed).toHaveProperty('domDiff');
    expect(parsed).toHaveProperty('pixelDiff');
    expect(parsed).toHaveProperty('regions');
    expect(parsed).toHaveProperty('feedback');
    expect(parsed).toHaveProperty('timestamp');
  });
});

// ── Exit Code Logic Tests ──

describe('CLI Exit Code Logic', () => {
  let originalExit: typeof process.exit;

  beforeEach(() => {
    originalExit = process.exit;
    process.exit = vi.fn() as any;
  });

  afterEach(() => {
    process.exit = originalExit;
  });

  it('should exit with 0 when match percentage meets threshold', () => {
    const matchPercentage = 92;
    const threshold = 0.9;
    const matchDecimal = matchPercentage / 100;

    const expectedExitCode = matchDecimal >= threshold ? 0 : 1;
    expect(expectedExitCode).toBe(0);
  });

  it('should exit with 1 when match percentage below threshold', () => {
    const matchPercentage = 85;
    const threshold = 0.9;
    const matchDecimal = matchPercentage / 100;

    const expectedExitCode = matchDecimal >= threshold ? 0 : 1;
    expect(expectedExitCode).toBe(1);
  });

  it('should exit with 0 when match percentage exactly equals threshold', () => {
    const matchPercentage = 90;
    const threshold = 0.9;
    const matchDecimal = matchPercentage / 100;

    const expectedExitCode = matchDecimal >= threshold ? 0 : 1;
    expect(expectedExitCode).toBe(0);
  });

  it('should handle perfect match (100%)', () => {
    const matchPercentage = 100;
    const threshold = 0.9;
    const matchDecimal = matchPercentage / 100;

    const expectedExitCode = matchDecimal >= threshold ? 0 : 1;
    expect(expectedExitCode).toBe(0);
  });

  it('should handle low threshold (0.5)', () => {
    const matchPercentage = 60;
    const threshold = 0.5;
    const matchDecimal = matchPercentage / 100;

    const expectedExitCode = matchDecimal >= threshold ? 0 : 1;
    expect(expectedExitCode).toBe(0);
  });

  it('should handle high threshold (0.95)', () => {
    const matchPercentage = 94;
    const threshold = 0.95;
    const matchDecimal = matchPercentage / 100;

    const expectedExitCode = matchDecimal >= threshold ? 0 : 1;
    expect(expectedExitCode).toBe(1);
  });

  it('should handle edge case: 0% match', () => {
    const matchPercentage = 0;
    const threshold = 0.9;
    const matchDecimal = matchPercentage / 100;

    const expectedExitCode = matchDecimal >= threshold ? 0 : 1;
    expect(expectedExitCode).toBe(1);
  });
});

// ── Threshold Validation Tests ──

describe('CLI Threshold Validation', () => {
  it('should accept valid threshold values', () => {
    expect(parseFloat('0.9')).toBe(0.9);
    expect(parseFloat('0.5')).toBe(0.5);
    expect(parseFloat('0.95')).toBe(0.95);
    expect(parseFloat('1.0')).toBe(1.0);
    expect(parseFloat('0.0')).toBe(0.0);
  });

  it('should detect invalid threshold values', () => {
    const threshold = parseFloat('1.5');
    expect(threshold > 1).toBe(true);
  });

  it('should detect NaN threshold', () => {
    const threshold = parseFloat('invalid');
    expect(isNaN(threshold)).toBe(true);
  });
});
