/**
 * Tests for ComparisonEngine and FeedbackGenerator
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComparisonEngine } from './comparison-engine.js';
import { FeedbackGenerator } from './feedback-generator.js';
import type {
  DOMDiffResult,
  PixelDiffResult,
  DiffRegion,
  DOMElementStyle,
  ComparisonResult,
} from './types.js';

describe('FeedbackGenerator', () => {
  let generator: FeedbackGenerator;

  beforeEach(() => {
    generator = new FeedbackGenerator();
  });

  describe('generate', () => {
    it('should generate feedback from DOM mismatches', () => {
      const domDiff: DOMDiffResult = {
        matches: 10,
        mismatches: [
          {
            element: '.button',
            property: 'background-color',
            expected: '#007bff',
            actual: '#0056b3',
            severity: 'fail',
            fix: 'Update background-color to #007bff',
          },
          {
            element: '.text',
            property: 'font-size',
            expected: '16px',
            actual: '14px',
            severity: 'warn',
          },
        ],
        missing: [],
        extra: [],
      };

      const pixelDiff: PixelDiffResult = {
        totalPixels: 1000,
        diffPixels: 50,
        diffPercentage: 0.05,
        pixelComparisonRan: true,
      };

      const feedback = generator.generate(domDiff, pixelDiff, []);

      expect(feedback).toHaveLength(2);
      expect(feedback[0].severity).toBe('fail');
      expect(feedback[0].category).toBe('color');
      expect(feedback[0].element).toBe('.button');
      expect(feedback[1].severity).toBe('warn');
      expect(feedback[1].category).toBe('typography');
    });

    it('should order feedback by severity: fail > warn > pass', () => {
      const domDiff: DOMDiffResult = {
        matches: 5,
        mismatches: [
          {
            element: '.warn',
            property: 'padding',
            expected: '10px',
            actual: '12px',
            severity: 'warn',
          },
          {
            element: '.fail',
            property: 'color',
            expected: '#000',
            actual: '#fff',
            severity: 'fail',
          },
        ],
        missing: [],
        extra: [],
      };

      const feedback = generator.generate(domDiff, { totalPixels: 0, diffPixels: 0, diffPercentage: 0, pixelComparisonRan: false }, []);

      expect(feedback[0].severity).toBe('fail');
      expect(feedback[0].element).toBe('.fail');
      expect(feedback[1].severity).toBe('warn');
      expect(feedback[1].element).toBe('.warn');
    });

    it('should include missing and extra elements', () => {
      const domDiff: DOMDiffResult = {
        matches: 5,
        mismatches: [],
        missing: ['.missing-button'],
        extra: ['.extra-div'],
      };

      const feedback = generator.generate(domDiff, { totalPixels: 0, diffPixels: 0, diffPercentage: 0, pixelComparisonRan: false }, []);

      expect(feedback).toHaveLength(2);
      expect(feedback[0].severity).toBe('fail');
      expect(feedback[0].category).toBe('missing');
      expect(feedback[1].severity).toBe('warn');
      expect(feedback[1].category).toBe('extra');
    });

    it('should map pixel regions to DOM elements', () => {
      const region: DiffRegion = {
        bounds: { x: 10, y: 10, width: 50, height: 30 },
        severity: 'warn',
        type: 'color',
        description: 'Color mismatch detected',
      };

      const domStyles: DOMElementStyle[] = [
        {
          selector: '.container',
          tagName: 'div',
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          computedStyles: {},
        },
        {
          selector: '.button',
          tagName: 'button',
          bounds: { x: 5, y: 5, width: 60, height: 40 },
          computedStyles: {},
        },
      ];

      const feedback = generator.generate(
        { matches: 0, mismatches: [], missing: [], extra: [] },
        { totalPixels: 0, diffPixels: 0, diffPercentage: 0, pixelComparisonRan: false },
        [region],
        domStyles
      );

      expect(feedback).toHaveLength(1);
      expect(feedback[0].element).toBe('.button'); // Smallest containing element
    });
  });

  describe('generateSummary', () => {
    it('should generate summary with perfect match', () => {
      const result: ComparisonResult = {
        overall: {
          matchPercentage: 1.0,
          grade: 'A',
          summary: '',
        },
        domDiff: { matches: 10, mismatches: [], missing: [], extra: [] },
        pixelDiff: { totalPixels: 1000, diffPixels: 0, diffPercentage: 0, pixelComparisonRan: true },
        regions: [],
        feedback: [],
        timestamp: Date.now(),
      };

      const summary = generator.generateSummary(result);

      expect(summary).toContain('100%');
      expect(summary).toContain('Grade A');
      expect(summary).toContain('Perfect match!');
    });

    it('should generate summary with issues', () => {
      const result: ComparisonResult = {
        overall: {
          matchPercentage: 0.87,
          grade: 'B',
          summary: '',
        },
        domDiff: {
          matches: 8,
          mismatches: [
            {
              element: '.button',
              property: 'background-color',
              expected: '#007bff',
              actual: '#0056b3',
              severity: 'fail',
            },
          ],
          missing: ['.icon'],
          extra: [],
        },
        pixelDiff: { totalPixels: 1000, diffPixels: 50, diffPercentage: 0.05, pixelComparisonRan: true },
        regions: [
          {
            bounds: { x: 0, y: 0, width: 10, height: 10 },
            severity: 'warn',
            type: 'color',
            description: 'Color difference',
          },
        ],
        feedback: [
          { severity: 'fail', category: 'color', message: 'Color mismatch' },
          { severity: 'fail', category: 'missing', message: 'Missing element' },
          { severity: 'warn', category: 'color', message: 'Color difference' },
        ],
        timestamp: Date.now(),
      };

      const summary = generator.generateSummary(result);

      expect(summary).toContain('87%');
      expect(summary).toContain('Grade B');
      expect(summary).toContain('3 issues found');
      expect(summary).toContain('color');
    });

    it('should NOT say "Perfect match!" when grade is not A even with no feedback', () => {
      const result: ComparisonResult = {
        overall: {
          matchPercentage: 0.3,
          grade: 'F',
          summary: '',
        },
        domDiff: { matches: 0, mismatches: [], missing: [], extra: [] },
        pixelDiff: { totalPixels: 0, diffPixels: 0, diffPercentage: 0, pixelComparisonRan: false },
        regions: [],
        feedback: [],
        timestamp: Date.now(),
      };

      const summary = generator.generateSummary(result);

      expect(summary).not.toContain('Perfect match!');
      expect(summary).toContain('Some discrepancies detected.');
    });

    it('should say "Perfect match!" only when grade is A and no feedback', () => {
      const result: ComparisonResult = {
        overall: {
          matchPercentage: 1.0,
          grade: 'A',
          summary: '',
        },
        domDiff: { matches: 10, mismatches: [], missing: [], extra: [] },
        pixelDiff: { totalPixels: 1000, diffPixels: 0, diffPercentage: 0, pixelComparisonRan: true },
        regions: [],
        feedback: [],
        timestamp: Date.now(),
      };

      const summary = generator.generateSummary(result);

      expect(summary).toContain('Perfect match!');
    });
  });

  describe('mapRegionToElement', () => {
    it('should map region to smallest containing element', () => {
      const region: DiffRegion = {
        bounds: { x: 15, y: 15, width: 30, height: 20 },
        severity: 'fail',
        type: 'color',
        description: 'Test region',
      };

      const domStyles: DOMElementStyle[] = [
        {
          selector: '.container',
          tagName: 'div',
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          computedStyles: {},
        },
        {
          selector: '.button',
          tagName: 'button',
          bounds: { x: 10, y: 10, width: 50, height: 40 },
          computedStyles: {},
        },
        {
          selector: '.icon',
          tagName: 'span',
          bounds: { x: 12, y: 12, width: 35, height: 25 },
          computedStyles: {},
        },
      ];

      const element = generator.mapRegionToElement(region, domStyles);

      expect(element).toBe('.icon'); // Smallest containing bounds
    });

    it('should return undefined if no element contains region', () => {
      const region: DiffRegion = {
        bounds: { x: 200, y: 200, width: 10, height: 10 },
        severity: 'fail',
        type: 'color',
        description: 'Test region',
      };

      const domStyles: DOMElementStyle[] = [
        {
          selector: '.button',
          tagName: 'button',
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          computedStyles: {},
        },
      ];

      const element = generator.mapRegionToElement(region, domStyles);

      expect(element).toBeUndefined();
    });
  });
});

describe('ComparisonEngine', () => {
  let engine: ComparisonEngine;

  beforeEach(() => {
    engine = new ComparisonEngine();
  });

  describe('computeOverallScore', () => {
    it('should compute Grade A for perfect match', () => {
      const domDiff: DOMDiffResult = {
        matches: 20,
        mismatches: [],
        missing: [],
        extra: [],
      };

      const pixelDiff: PixelDiffResult = {
        totalPixels: 1000,
        diffPixels: 0,
        diffPercentage: 0,
        pixelComparisonRan: true,
      };

      // Access private method via type assertion
      const score = (engine as any).computeOverallScore(domDiff, pixelDiff, []);

      expect(score.grade).toBe('A');
      expect(score.matchPercentage).toBeGreaterThan(0.95);
    });

    it('should compute Grade B for good match with minor issues', () => {
      const domDiff: DOMDiffResult = {
        matches: 18,
        mismatches: [
          {
            element: '.text',
            property: 'padding',
            expected: '10px',
            actual: '12px',
            severity: 'warn',
          },
          {
            element: '.icon',
            property: 'color',
            expected: '#000',
            actual: '#111',
            severity: 'warn',
          },
        ],
        missing: ['el1'],
        extra: [],
      };

      const pixelDiff: PixelDiffResult = {
        totalPixels: 1000,
        diffPixels: 30,
        diffPercentage: 0.03,
        pixelComparisonRan: true,
      };

      const score = (engine as any).computeOverallScore(domDiff, pixelDiff, []);

      expect(score.grade).toBe('B');
      expect(score.matchPercentage).toBeGreaterThan(0.85);
      expect(score.matchPercentage).toBeLessThanOrEqual(0.95);
    });

    it('should compute Grade C for moderate match', () => {
      const domDiff: DOMDiffResult = {
        matches: 15,
        mismatches: [
          {
            element: '.button',
            property: 'background-color',
            expected: '#007bff',
            actual: '#0056b3',
            severity: 'fail',
          },
          {
            element: '.text',
            property: 'font-size',
            expected: '16px',
            actual: '14px',
            severity: 'warn',
          },
          {
            element: '.container',
            property: 'padding',
            expected: '20px',
            actual: '16px',
            severity: 'warn',
          },
        ],
        missing: ['el1', 'el2', 'el3'],
        extra: [],
      };

      const pixelDiff: PixelDiffResult = {
        totalPixels: 1000,
        diffPixels: 100,
        diffPercentage: 0.1,
        pixelComparisonRan: true,
      };

      const score = (engine as any).computeOverallScore(domDiff, pixelDiff, []);

      expect(score.grade).toBe('C');
      expect(score.matchPercentage).toBeGreaterThan(0.7);
      expect(score.matchPercentage).toBeLessThanOrEqual(0.85);
    });

    it('should compute Grade F for poor match', () => {
      const domDiff: DOMDiffResult = {
        matches: 3,
        mismatches: [
          {
            element: '.button',
            property: 'background-color',
            expected: '#007bff',
            actual: '#ff0000',
            severity: 'fail',
          },
          {
            element: '.text',
            property: 'color',
            expected: '#000',
            actual: '#fff',
            severity: 'fail',
          },
          {
            element: '.container',
            property: 'width',
            expected: '1000px',
            actual: '500px',
            severity: 'fail',
          },
        ],
        missing: ['.icon', '.badge', '.card', '.header', '.nav', '.footer', '.sidebar'],
        extra: [],
      };

      const pixelDiff: PixelDiffResult = {
        totalPixels: 1000,
        diffPixels: 500,
        diffPercentage: 50,
        pixelComparisonRan: true,
      };

      const score = (engine as any).computeOverallScore(domDiff, pixelDiff, []);

      expect(score.grade).toBe('F');
      expect(score.matchPercentage).toBeLessThanOrEqual(0.5);
    });

    it('should weight DOM comparison more heavily than pixel diff', () => {
      // Perfect DOM match, poor pixel match
      const domDiff1: DOMDiffResult = {
        matches: 20,
        mismatches: [],
        missing: [],
        extra: [],
      };

      const pixelDiff1: PixelDiffResult = {
        totalPixels: 1000,
        diffPixels: 300,
        diffPercentage: 0.3,
        pixelComparisonRan: true,
      };

      // Poor DOM match, perfect pixel match
      const domDiff2: DOMDiffResult = {
        matches: 5,
        mismatches: [
          {
            element: '.test',
            property: 'color',
            expected: '#000',
            actual: '#fff',
            severity: 'fail',
          },
        ],
        missing: [],
        extra: [],
      };

      const pixelDiff2: PixelDiffResult = {
        totalPixels: 1000,
        diffPixels: 0,
        diffPercentage: 0,
        pixelComparisonRan: true,
      };

      const score1 = (engine as any).computeOverallScore(domDiff1, pixelDiff1, []);
      const score2 = (engine as any).computeOverallScore(domDiff2, pixelDiff2, []);

      // Perfect DOM should score higher despite poor pixel match
      expect(score1.matchPercentage).toBeGreaterThan(score2.matchPercentage);
    });
  });
});
