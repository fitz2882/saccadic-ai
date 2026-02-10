/**
 * Spacing/padding/gap mismatch test fixtures.
 *
 * Tests padding and gap mismatches at three severity levels
 * using Weber fraction thresholds.
 */

import type { TestFixture } from '../types.js';

export function getSpacingFixtures(): TestFixture[] {
  return [
    // ── Imperceptible (< 2% Weber) ──
    {
      id: 'spacing-padding-imperceptible',
      name: 'Padding imperceptible shift',
      category: 'spacing',
      designHtml: `<html><body style="margin:0"><div id="card" style="box-sizing:border-box;width:300px;padding:20px;background:#F3F4F6;font:400 16px/18px sans-serif">Content</div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="card" style="box-sizing:border-box;width:300px;padding:20px;background:#F3F4F6;font:400 16px/18px sans-serif">Content</div></body></html>`,
      designState: {
        id: 'spacing-padding-imperceptible',
        name: 'Spacing Padding Imperceptible',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'card', name: 'Card', type: 'FRAME', children: [],
          bounds: { x: 0, y: 0, width: 300, height: 58 },
          padding: { top: 20, right: 20, bottom: 20, left: 20 },
          fills: [{ type: 'SOLID', color: '#F3F4F6' }],
        }],
      },
      groundTruth: [], // No mismatch — padding matches
    },

    // ── Noticeable (2-4% Weber) ──
    {
      id: 'spacing-padding-noticeable',
      name: 'Padding noticeable shift',
      category: 'spacing',
      designHtml: `<html><body style="margin:0"><div id="card" style="box-sizing:border-box;width:300px;padding:24px;background:#F3F4F6;font:400 16px/18px sans-serif">Content</div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="card" style="box-sizing:border-box;width:300px;padding:20px;background:#F3F4F6;font:400 16px/18px sans-serif">Content</div></body></html>`,
      designState: {
        id: 'spacing-padding-noticeable',
        name: 'Spacing Padding Noticeable',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'card', name: 'Card', type: 'FRAME', children: [],
          bounds: { x: 0, y: 0, width: 300, height: 66 },
          padding: { top: 24, right: 24, bottom: 24, left: 24 },
          fills: [{ type: 'SOLID', color: '#F3F4F6' }],
        }],
      },
      groundTruth: [
        {
          category: 'spacing',
          severity: 'noticeable',
          element: '#card',
          property: 'paddingTop',
          expected: '24px',
          actual: '20px',
          description: 'Padding top 24px vs 20px',
        },
        {
          category: 'spacing',
          severity: 'noticeable',
          element: '#card',
          property: 'paddingRight',
          expected: '24px',
          actual: '20px',
          description: 'Padding right 24px vs 20px',
        },
        {
          category: 'spacing',
          severity: 'noticeable',
          element: '#card',
          property: 'paddingBottom',
          expected: '24px',
          actual: '20px',
          description: 'Padding bottom 24px vs 20px',
        },
        {
          category: 'spacing',
          severity: 'noticeable',
          element: '#card',
          property: 'paddingLeft',
          expected: '24px',
          actual: '20px',
          description: 'Padding left 24px vs 20px',
        },
      ],
    },

    // ── Major (> 4% Weber) ──
    {
      id: 'spacing-padding-major',
      name: 'Padding major mismatch',
      category: 'spacing',
      designHtml: `<html><body style="margin:0"><div id="card" style="box-sizing:border-box;width:300px;padding:32px;background:#F3F4F6;font:400 16px/18px sans-serif">Content</div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="card" style="box-sizing:border-box;width:300px;padding:8px;background:#F3F4F6;font:400 16px/18px sans-serif">Content</div></body></html>`,
      designState: {
        id: 'spacing-padding-major',
        name: 'Spacing Padding Major',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'card', name: 'Card', type: 'FRAME', children: [],
          bounds: { x: 0, y: 0, width: 300, height: 82 },
          padding: { top: 32, right: 32, bottom: 32, left: 32 },
          fills: [{ type: 'SOLID', color: '#F3F4F6' }],
        }],
      },
      groundTruth: [
        {
          category: 'spacing',
          severity: 'major',
          element: '#card',
          property: 'paddingTop',
          expected: '32px',
          actual: '8px',
          description: 'Padding top 32px vs 8px',
        },
        {
          category: 'spacing',
          severity: 'major',
          element: '#card',
          property: 'paddingRight',
          expected: '32px',
          actual: '8px',
          description: 'Padding right 32px vs 8px',
        },
        {
          category: 'spacing',
          severity: 'major',
          element: '#card',
          property: 'paddingBottom',
          expected: '32px',
          actual: '8px',
          description: 'Padding bottom 32px vs 8px',
        },
        {
          category: 'spacing',
          severity: 'major',
          element: '#card',
          property: 'paddingLeft',
          expected: '32px',
          actual: '8px',
          description: 'Padding left 32px vs 8px',
        },
      ],
    },

    // ── Gap mismatch ──
    {
      id: 'spacing-gap-major',
      name: 'Flex gap major mismatch',
      category: 'spacing',
      designHtml: `<html><body style="margin:0"><div id="row" style="display:inline-flex;gap:24px"><div style="width:100px;height:50px;background:#3B82F6"></div><div style="width:100px;height:50px;background:#3B82F6"></div></div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="row" style="display:inline-flex;gap:4px"><div style="width:100px;height:50px;background:#3B82F6"></div><div style="width:100px;height:50px;background:#3B82F6"></div></div></body></html>`,
      designState: {
        id: 'spacing-gap-major',
        name: 'Spacing Gap Major',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'row', name: 'Row', type: 'FRAME', children: [
            { id: 'box1', name: 'Box 1', type: 'RECTANGLE', children: [], bounds: { x: 0, y: 0, width: 100, height: 50 }, fills: [{ type: 'SOLID', color: '#3B82F6' }] },
            { id: 'box2', name: 'Box 2', type: 'RECTANGLE', children: [], bounds: { x: 124, y: 0, width: 100, height: 50 }, fills: [{ type: 'SOLID', color: '#3B82F6' }] },
          ],
          bounds: { x: 0, y: 0, width: 224, height: 50 },
          layoutMode: 'HORIZONTAL',
          gap: 24,
        }],
      },
      groundTruth: [{
        category: 'spacing',
        severity: 'major',
        element: '#row',
        property: 'gap',
        expected: '24px',
        actual: '4px',
        description: 'Flex gap 24px vs 4px',
      }],
    },

    // ── Asymmetric padding ──
    {
      id: 'spacing-asymmetric',
      name: 'Asymmetric padding mismatch',
      category: 'spacing',
      designHtml: `<html><body style="margin:0"><div id="card" style="box-sizing:border-box;width:300px;padding:16px 32px;background:#F3F4F6;font:400 16px/18px sans-serif">Content</div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="card" style="box-sizing:border-box;width:300px;padding:16px 16px;background:#F3F4F6;font:400 16px/18px sans-serif">Content</div></body></html>`,
      designState: {
        id: 'spacing-asymmetric',
        name: 'Spacing Asymmetric',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'card', name: 'Card', type: 'FRAME', children: [],
          bounds: { x: 0, y: 0, width: 300, height: 50 },
          padding: { top: 16, right: 32, bottom: 16, left: 32 },
          fills: [{ type: 'SOLID', color: '#F3F4F6' }],
        }],
      },
      groundTruth: [
        {
          category: 'spacing',
          severity: 'major',
          element: '#card',
          property: 'paddingRight',
          expected: '32px',
          actual: '16px',
          description: 'Padding right 32px vs 16px',
        },
        {
          category: 'spacing',
          severity: 'major',
          element: '#card',
          property: 'paddingLeft',
          expected: '32px',
          actual: '16px',
          description: 'Padding left 32px vs 16px',
        },
      ],
    },
  ];
}
