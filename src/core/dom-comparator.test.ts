/**
 * Tests for DOM Comparator module.
 */

import { describe, it, expect } from 'vitest';
import { DOMComparator } from './dom-comparator.js';
import type { DOMElementStyle, DesignNode } from './types.js';

describe('DOMComparator', () => {
  const comparator = new DOMComparator();

  describe('matchElements', () => {
    it('should match elements by bounds overlap (IoU calculation)', () => {
      const domStyles: DOMElementStyle[] = [
        {
          selector: '.card',
          tagName: 'DIV',
          bounds: { x: 10, y: 10, width: 100, height: 50 },
          computedStyles: {},
        },
      ];

      const designNodes: DesignNode[] = [
        {
          id: 'node1',
          name: 'Card',
          type: 'FRAME',
          bounds: { x: 12, y: 12, width: 98, height: 48 }, // Overlaps ~90%
          children: [],
        },
      ];

      const matches = comparator.matchElements(domStyles, designNodes);

      expect(matches).toHaveLength(1);
      expect(matches[0].domElement.selector).toBe('.card');
      expect(matches[0].designNode.id).toBe('node1');
      expect(matches[0].confidence).toBeGreaterThan(0.8);
    });

    it('should not match elements with insufficient overlap', () => {
      const domStyles: DOMElementStyle[] = [
        {
          selector: '.card',
          tagName: 'DIV',
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          computedStyles: {},
        },
      ];

      const designNodes: DesignNode[] = [
        {
          id: 'node1',
          name: 'Card',
          type: 'FRAME',
          bounds: { x: 200, y: 200, width: 100, height: 100 }, // No overlap
          children: [],
        },
      ];

      const matches = comparator.matchElements(domStyles, designNodes);

      expect(matches).toHaveLength(0);
    });

    it('should match best candidate when multiple overlaps exist', () => {
      const domStyles: DOMElementStyle[] = [
        {
          selector: '.card',
          tagName: 'DIV',
          bounds: { x: 10, y: 10, width: 100, height: 100 },
          computedStyles: {},
        },
      ];

      const designNodes: DesignNode[] = [
        {
          id: 'node1',
          name: 'Card A',
          type: 'FRAME',
          bounds: { x: 15, y: 15, width: 90, height: 90 }, // High overlap
          children: [],
        },
        {
          id: 'node2',
          name: 'Card B',
          type: 'FRAME',
          bounds: { x: 50, y: 50, width: 100, height: 100 }, // Lower overlap
          children: [],
        },
      ];

      const matches = comparator.matchElements(domStyles, designNodes);

      expect(matches).toHaveLength(1);
      expect(matches[0].designNode.id).toBe('node1'); // Best match
      expect(matches[0].confidence).toBeGreaterThan(0.7);
    });
  });

  describe('compareProperties - colors', () => {
    it('should catch color mismatches', () => {
      const domStyle: DOMElementStyle = {
        selector: '.button',
        tagName: 'BUTTON',
        bounds: { x: 0, y: 0, width: 100, height: 40 },
        computedStyles: {
          backgroundColor: 'rgb(255, 0, 0)', // Red
          color: '#000000',
        },
      };

      const designNode: DesignNode = {
        id: 'node1',
        name: 'Button',
        type: 'BUTTON',
        bounds: { x: 0, y: 0, width: 100, height: 40 },
        fills: [{ type: 'SOLID', color: '#0000FF' }], // Blue
        typography: { fontFamily: 'Arial', fontSize: 16, fontWeight: 400, color: '#FFFFFF' }, // White
        children: [],
      };

      const mismatches = comparator.compareProperties(domStyle, designNode);

      expect(mismatches.length).toBeGreaterThan(0);

      const bgMismatch = mismatches.find((m) => m.property === 'backgroundColor');
      expect(bgMismatch).toBeDefined();
      expect(bgMismatch?.expected).toBe('#0000FF');
      expect(bgMismatch?.actual).toBe('#FF0000');
      expect(bgMismatch?.severity).toBe('fail');

      const colorMismatch = mismatches.find((m) => m.property === 'color');
      expect(colorMismatch).toBeDefined();
      expect(colorMismatch?.expected).toBe('#FFFFFF');
      expect(colorMismatch?.actual).toBe('#000000');
    });

    it('should pass when colors match', () => {
      const domStyle: DOMElementStyle = {
        selector: '.button',
        tagName: 'BUTTON',
        bounds: { x: 0, y: 0, width: 100, height: 40 },
        computedStyles: {
          backgroundColor: '#0066FF',
        },
      };

      const designNode: DesignNode = {
        id: 'node1',
        name: 'Button',
        type: 'BUTTON',
        bounds: { x: 0, y: 0, width: 100, height: 40 },
        fills: [{ type: 'SOLID', color: '#0066FF' }],
        children: [],
      };

      const mismatches = comparator.compareProperties(domStyle, designNode);

      const bgMismatch = mismatches.find((m) => m.property === 'backgroundColor');
      expect(bgMismatch).toBeUndefined();
    });
  });

  describe('compareProperties - typography', () => {
    it('should catch typography mismatches', () => {
      const domStyle: DOMElementStyle = {
        selector: '.text',
        tagName: 'P',
        bounds: { x: 0, y: 0, width: 200, height: 30 },
        computedStyles: {
          fontSize: '14px',
          fontWeight: '400',
          fontFamily: 'Helvetica',
          lineHeight: '20px',
          letterSpacing: '0px',
        },
      };

      const designNode: DesignNode = {
        id: 'node1',
        name: 'Text',
        type: 'TEXT',
        bounds: { x: 0, y: 0, width: 200, height: 30 },
        typography: {
          fontFamily: 'Arial',
          fontSize: 16,
          fontWeight: 600,
          lineHeight: 24,
          letterSpacing: 0.5,
        },
        children: [],
      };

      const mismatches = comparator.compareProperties(domStyle, designNode);

      expect(mismatches.length).toBeGreaterThan(0);

      const fontSizeMismatch = mismatches.find((m) => m.property === 'fontSize');
      expect(fontSizeMismatch).toBeDefined();
      expect(fontSizeMismatch?.expected).toBe('16px');
      expect(fontSizeMismatch?.actual).toBe('14px');

      const fontWeightMismatch = mismatches.find((m) => m.property === 'fontWeight');
      expect(fontWeightMismatch).toBeDefined();
      expect(fontWeightMismatch?.expected).toBe('600');
      expect(fontWeightMismatch?.actual).toBe('400');

      const fontFamilyMismatch = mismatches.find((m) => m.property === 'fontFamily');
      expect(fontFamilyMismatch).toBeDefined();
      expect(fontFamilyMismatch?.expected).toBe('Arial');
      expect(fontFamilyMismatch?.actual).toBe('Helvetica');

      const lineHeightMismatch = mismatches.find((m) => m.property === 'lineHeight');
      expect(lineHeightMismatch).toBeDefined();

      const letterSpacingMismatch = mismatches.find((m) => m.property === 'letterSpacing');
      expect(letterSpacingMismatch).toBeDefined();
    });
  });

  describe('compareProperties - spacing', () => {
    it('should catch spacing mismatches (padding)', () => {
      const domStyle: DOMElementStyle = {
        selector: '.container',
        tagName: 'DIV',
        bounds: { x: 0, y: 0, width: 300, height: 200 },
        computedStyles: {
          padding: '8px 16px',
        },
      };

      const designNode: DesignNode = {
        id: 'node1',
        name: 'Container',
        type: 'FRAME',
        bounds: { x: 0, y: 0, width: 300, height: 200 },
        padding: { top: 16, right: 24, bottom: 16, left: 24 },
        children: [],
      };

      const mismatches = comparator.compareProperties(domStyle, designNode);

      expect(mismatches.length).toBeGreaterThan(0);

      const topMismatch = mismatches.find((m) => m.property === 'paddingTop');
      expect(topMismatch).toBeDefined();
      expect(topMismatch?.expected).toBe('16px');
      expect(topMismatch?.actual).toBe('8px');

      const rightMismatch = mismatches.find((m) => m.property === 'paddingRight');
      expect(rightMismatch).toBeDefined();
      expect(rightMismatch?.expected).toBe('24px');
      expect(rightMismatch?.actual).toBe('16px');
    });

    it('should catch gap mismatches', () => {
      const domStyle: DOMElementStyle = {
        selector: '.grid',
        tagName: 'DIV',
        bounds: { x: 0, y: 0, width: 400, height: 300 },
        computedStyles: {
          gap: '8px',
        },
      };

      const designNode: DesignNode = {
        id: 'node1',
        name: 'Grid',
        type: 'FRAME',
        bounds: { x: 0, y: 0, width: 400, height: 300 },
        gap: 12,
        children: [],
      };

      const mismatches = comparator.compareProperties(domStyle, designNode);

      const gapMismatch = mismatches.find((m) => m.property === 'gap');
      expect(gapMismatch).toBeDefined();
      expect(gapMismatch?.expected).toBe('12px');
      expect(gapMismatch?.actual).toBe('8px');
    });
  });

  describe('CSS value parsing', () => {
    it('should parse pixel values', () => {
      const domStyle: DOMElementStyle = {
        selector: '.test',
        tagName: 'DIV',
        bounds: { x: 0, y: 0, width: 100, height: 50 },
        computedStyles: {
          width: '100px',
          height: '50px',
        },
      };

      const designNode: DesignNode = {
        id: 'node1',
        name: 'Test',
        type: 'FRAME',
        bounds: { x: 0, y: 0, width: 100, height: 50 },
        children: [],
      };

      const mismatches = comparator.compareProperties(domStyle, designNode);

      // Should have no mismatches since values match
      const widthMismatch = mismatches.find((m) => m.property === 'width');
      expect(widthMismatch).toBeUndefined();

      const heightMismatch = mismatches.find((m) => m.property === 'height');
      expect(heightMismatch).toBeUndefined();
    });

    it('should parse RGB colors to hex', () => {
      const domStyle: DOMElementStyle = {
        selector: '.test',
        tagName: 'DIV',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        computedStyles: {
          backgroundColor: 'rgb(0, 102, 255)',
        },
      };

      const designNode: DesignNode = {
        id: 'node1',
        name: 'Test',
        type: 'FRAME',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        fills: [{ type: 'SOLID', color: '#0066FF' }],
        children: [],
      };

      const mismatches = comparator.compareProperties(domStyle, designNode);

      const bgMismatch = mismatches.find((m) => m.property === 'backgroundColor');
      expect(bgMismatch).toBeUndefined(); // Should match after conversion
    });

    it('should parse RGBA colors to hex', () => {
      const domStyle: DOMElementStyle = {
        selector: '.test',
        tagName: 'DIV',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        computedStyles: {
          color: 'rgba(255, 255, 255, 0.9)',
        },
      };

      const designNode: DesignNode = {
        id: 'node1',
        name: 'Test',
        type: 'FRAME',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        typography: {
          fontFamily: 'Arial',
          fontSize: 16,
          fontWeight: 400,
          color: '#FFFFFF',
        },
        children: [],
      };

      const mismatches = comparator.compareProperties(domStyle, designNode);

      const colorMismatch = mismatches.find((m) => m.property === 'color');
      expect(colorMismatch).toBeUndefined(); // Should match after conversion
    });

    it('should parse shorthand padding', () => {
      const domStyle: DOMElementStyle = {
        selector: '.test',
        tagName: 'DIV',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        computedStyles: {
          padding: '16px',
        },
      };

      const designNode: DesignNode = {
        id: 'node1',
        name: 'Test',
        type: 'FRAME',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        children: [],
      };

      const mismatches = comparator.compareProperties(domStyle, designNode);

      const paddingMismatches = mismatches.filter((m) => m.property.startsWith('padding'));
      expect(paddingMismatches).toHaveLength(0);
    });

    it('should parse 2-value padding shorthand', () => {
      const domStyle: DOMElementStyle = {
        selector: '.test',
        tagName: 'DIV',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        computedStyles: {
          padding: '12px 24px',
        },
      };

      const designNode: DesignNode = {
        id: 'node1',
        name: 'Test',
        type: 'FRAME',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        padding: { top: 12, right: 24, bottom: 12, left: 24 },
        children: [],
      };

      const mismatches = comparator.compareProperties(domStyle, designNode);

      const paddingMismatches = mismatches.filter((m) => m.property.startsWith('padding'));
      expect(paddingMismatches).toHaveLength(0);
    });
  });

  describe('generateFix', () => {
    it('should generate CSS fix suggestion', () => {
      const mismatch = {
        element: '.card-grid',
        property: 'gap',
        expected: '12px',
        actual: '8px',
        severity: 'warn' as const,
      };

      const fix = comparator.generateFix(mismatch);

      expect(fix).toBe('Change `gap: 8px` to `gap: 12px` on `.card-grid`');
    });

    it('should generate fix for color property', () => {
      const mismatch = {
        element: '.button',
        property: 'backgroundColor',
        expected: '#0066FF',
        actual: '#FF0000',
        severity: 'fail' as const,
      };

      const fix = comparator.generateFix(mismatch);

      expect(fix).toBe('Change `backgroundColor: #FF0000` to `backgroundColor: #0066FF` on `.button`');
    });
  });

  describe('computePositionSeverity', () => {
    it('should use Weber fraction for severity calculation', () => {
      // Pass: < 2% difference
      expect(comparator.computePositionSeverity(100, 101, 100)).toBe('pass');

      // Warn: 2-4% difference
      expect(comparator.computePositionSeverity(100, 103, 100)).toBe('warn');

      // Fail: > 4% difference
      expect(comparator.computePositionSeverity(100, 105, 100)).toBe('fail');
    });

    it('should avoid tiny-reference amplification', () => {
      // Small reference should use 100 as minimum
      // 5px difference with 5px reference would normally be 100% error
      // But with min reference of 100, it's only 5% error
      expect(comparator.computePositionSeverity(5, 10, 5)).toBe('fail'); // 5/100 = 5% > 4%
      expect(comparator.computePositionSeverity(2, 4, 2)).toBe('pass'); // 2/100 = 2% == 2%
    });

    it('should handle larger references normally', () => {
      // 10px difference with 500px reference = 2% (warn)
      expect(comparator.computePositionSeverity(500, 510, 500)).toBe('warn');

      // 5px difference with 500px reference = 1% (pass)
      expect(comparator.computePositionSeverity(500, 505, 500)).toBe('pass');
    });
  });

  describe('compare', () => {
    it('should return clean result with no mismatches', () => {
      const domStyles: DOMElementStyle[] = [
        {
          selector: '.card',
          tagName: 'DIV',
          bounds: { x: 10, y: 10, width: 200, height: 100 },
          computedStyles: {
            backgroundColor: '#0066FF',
            width: '200px',
            height: '100px',
          },
        },
      ];

      const designNodes: DesignNode[] = [
        {
          id: 'node1',
          name: 'Card',
          type: 'FRAME',
          bounds: { x: 10, y: 10, width: 200, height: 100 },
          fills: [{ type: 'SOLID', color: '#0066FF' }],
          children: [],
        },
      ];

      const result = comparator.compare(domStyles, designNodes);

      expect(result.matches).toBe(1);
      expect(result.mismatches).toHaveLength(0);
      expect(result.missing).toHaveLength(0);
      expect(result.extra).toHaveLength(0);
    });

    it('should detect missing elements', () => {
      const domStyles: DOMElementStyle[] = [];

      const designNodes: DesignNode[] = [
        {
          id: 'node1',
          name: 'Card',
          type: 'FRAME',
          bounds: { x: 10, y: 10, width: 200, height: 100 },
          children: [],
        },
      ];

      const result = comparator.compare(domStyles, designNodes);

      expect(result.matches).toBe(0);
      expect(result.missing).toContain('Card');
    });

    it('should detect extra elements', () => {
      const domStyles: DOMElementStyle[] = [
        {
          selector: '.extra',
          tagName: 'DIV',
          bounds: { x: 10, y: 10, width: 200, height: 100 },
          computedStyles: {},
        },
      ];

      const designNodes: DesignNode[] = [];

      const result = comparator.compare(domStyles, designNodes);

      expect(result.matches).toBe(0);
      expect(result.extra).toContain('.extra');
    });

    it('should combine matches, mismatches, missing, and extra', () => {
      const domStyles: DOMElementStyle[] = [
        {
          selector: '.card',
          tagName: 'DIV',
          bounds: { x: 10, y: 10, width: 200, height: 100 },
          computedStyles: {
            backgroundColor: '#FF0000', // Wrong color
          },
        },
        {
          selector: '.extra',
          tagName: 'DIV',
          bounds: { x: 300, y: 300, width: 100, height: 100 },
          computedStyles: {},
        },
      ];

      const designNodes: DesignNode[] = [
        {
          id: 'node1',
          name: 'Card',
          type: 'FRAME',
          bounds: { x: 10, y: 10, width: 200, height: 100 },
          fills: [{ type: 'SOLID', color: '#0066FF' }],
          children: [],
        },
        {
          id: 'node2',
          name: 'Missing',
          type: 'FRAME',
          bounds: { x: 500, y: 500, width: 100, height: 100 },
          children: [],
        },
      ];

      const result = comparator.compare(domStyles, designNodes);

      expect(result.matches).toBe(1);
      expect(result.mismatches.length).toBeGreaterThan(0);
      expect(result.missing).toContain('Missing');
      expect(result.extra).toContain('.extra');
    });
  });
});
