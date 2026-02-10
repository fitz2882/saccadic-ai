/**
 * Typography mismatch test fixtures.
 *
 * Tests font-size, font-weight, and font-family mismatches.
 */

import type { TestFixture } from '../types.js';

export function getTypographyFixtures(): TestFixture[] {
  return [
    // ── Font size imperceptible (< 3%) ──
    {
      id: 'typo-size-imperceptible',
      name: 'Font size imperceptible shift',
      category: 'typography',
      designHtml: `<html><body style="margin:0"><p id="text" style="margin:0;font:400 16px/20px sans-serif">Hello world</p></body></html>`,
      buildHtml: `<html><body style="margin:0"><p id="text" style="margin:0;font:400 16px/20px sans-serif">Hello world</p></body></html>`,
      designState: {
        id: 'typo-size-imperceptible',
        name: 'Typography Size Imperceptible',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'text', name: 'Text', type: 'TEXT', children: [],
          bounds: { x: 0, y: 0, width: 800, height: 20 },
          typography: { fontFamily: 'sans-serif', fontSize: 16, fontWeight: 400, lineHeight: 20 },
        }],
      },
      groundTruth: [], // No mismatch
    },

    // ── Font size noticeable (3-5%) ──
    {
      id: 'typo-size-noticeable',
      name: 'Font size noticeable shift',
      category: 'typography',
      designHtml: `<html><body style="margin:0"><p id="text" style="margin:0;font:400 20px/24px sans-serif">Hello world</p></body></html>`,
      buildHtml: `<html><body style="margin:0"><p id="text" style="margin:0;font:400 19px/24px sans-serif">Hello world</p></body></html>`,
      designState: {
        id: 'typo-size-noticeable',
        name: 'Typography Size Noticeable',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'text', name: 'Text', type: 'TEXT', children: [],
          bounds: { x: 0, y: 0, width: 800, height: 24 },
          typography: { fontFamily: 'sans-serif', fontSize: 20, fontWeight: 400, lineHeight: 24 },
        }],
      },
      groundTruth: [{
        category: 'typography',
        severity: 'noticeable',
        element: '#text',
        property: 'fontSize',
        expected: '20px',
        actual: '19px',
        description: 'Font size 20px vs 19px (5% off)',
      }],
    },

    // ── Font size major (> 5%) ──
    {
      id: 'typo-size-major',
      name: 'Font size major mismatch',
      category: 'typography',
      designHtml: `<html><body style="margin:0"><p id="text" style="margin:0;font:400 24px/30px sans-serif">Hello world</p></body></html>`,
      buildHtml: `<html><body style="margin:0"><p id="text" style="margin:0;font:400 16px/20px sans-serif">Hello world</p></body></html>`,
      designState: {
        id: 'typo-size-major',
        name: 'Typography Size Major',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'text', name: 'Text', type: 'TEXT', children: [],
          bounds: { x: 0, y: 0, width: 800, height: 30 },
          typography: { fontFamily: 'sans-serif', fontSize: 24, fontWeight: 400, lineHeight: 30 },
        }],
      },
      groundTruth: [
        {
          category: 'typography',
          severity: 'major',
          element: '#text',
          property: 'fontSize',
          expected: '24px',
          actual: '16px',
          description: 'Font size 24px vs 16px (33% off)',
        },
        {
          category: 'typography',
          severity: 'major',
          element: '#text',
          property: 'lineHeight',
          expected: '30px',
          actual: '20px',
          description: 'Line height 30px vs 20px',
        },
      ],
    },

    // ── Font weight mismatch ──
    {
      id: 'typo-weight-major',
      name: 'Font weight mismatch',
      category: 'typography',
      designHtml: `<html><body style="margin:0"><p id="text" style="margin:0;font:700 16px/20px sans-serif">Bold text</p></body></html>`,
      buildHtml: `<html><body style="margin:0"><p id="text" style="margin:0;font:400 16px/20px sans-serif">Bold text</p></body></html>`,
      designState: {
        id: 'typo-weight-major',
        name: 'Typography Weight Major',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'text', name: 'Text', type: 'TEXT', children: [],
          bounds: { x: 0, y: 0, width: 800, height: 20 },
          typography: { fontFamily: 'sans-serif', fontSize: 16, fontWeight: 700, lineHeight: 20 },
        }],
      },
      groundTruth: [{
        category: 'typography',
        severity: 'major',
        element: '#text',
        property: 'fontWeight',
        expected: '700',
        actual: '400',
        description: 'Font weight bold vs normal',
      }],
    },

    // ── Font family mismatch ──
    {
      id: 'typo-family-major',
      name: 'Font family mismatch',
      category: 'typography',
      designHtml: `<html><body style="margin:0"><p id="text" style="margin:0;font:400 16px/20px Georgia,serif">Serif text</p></body></html>`,
      buildHtml: `<html><body style="margin:0"><p id="text" style="margin:0;font:400 16px/20px Arial,sans-serif">Serif text</p></body></html>`,
      designState: {
        id: 'typo-family-major',
        name: 'Typography Family Major',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'text', name: 'Text', type: 'TEXT', children: [],
          bounds: { x: 0, y: 0, width: 800, height: 20 },
          typography: { fontFamily: 'Georgia', fontSize: 16, fontWeight: 400, lineHeight: 20 },
        }],
      },
      groundTruth: [{
        category: 'typography',
        severity: 'major',
        element: '#text',
        property: 'fontFamily',
        expected: 'Georgia',
        actual: 'Arial, sans-serif',
        description: 'Font family Georgia vs Arial',
      }],
    },

    // ── Multiple typography issues ──
    {
      id: 'typo-multi',
      name: 'Multiple typography mismatches',
      category: 'typography',
      designHtml: `<html><body style="margin:0"><h1 id="heading" style="margin:0;font:700 32px/40px Georgia,serif">Heading</h1></body></html>`,
      buildHtml: `<html><body style="margin:0"><h1 id="heading" style="margin:0;font:400 24px/32px Arial,sans-serif">Heading</h1></body></html>`,
      designState: {
        id: 'typo-multi',
        name: 'Typography Multi',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'heading', name: 'Heading', type: 'TEXT', children: [],
          bounds: { x: 0, y: 0, width: 800, height: 40 },
          typography: { fontFamily: 'Georgia', fontSize: 32, fontWeight: 700, lineHeight: 40 },
        }],
      },
      groundTruth: [
        {
          category: 'typography',
          severity: 'major',
          element: '#heading',
          property: 'fontSize',
          expected: '32px',
          actual: '24px',
          description: 'Font size 32px vs 24px',
        },
        {
          category: 'typography',
          severity: 'major',
          element: '#heading',
          property: 'fontWeight',
          expected: '700',
          actual: '400',
          description: 'Font weight 700 vs 400',
        },
        {
          category: 'typography',
          severity: 'major',
          element: '#heading',
          property: 'fontFamily',
          expected: 'Georgia',
          actual: 'Arial, sans-serif',
          description: 'Font family Georgia vs Arial',
        },
        {
          category: 'typography',
          severity: 'major',
          element: '#heading',
          property: 'lineHeight',
          expected: '40px',
          actual: '32px',
          description: 'Line height 40px vs 32px',
        },
      ],
    },
  ];
}
