/**
 * Layout/position/size mismatch test fixtures.
 *
 * Tests width, height, and position mismatches at three severity levels.
 */

import type { TestFixture } from '../types.js';

export function getLayoutFixtures(): TestFixture[] {
  return [
    // ── Width imperceptible (< 3%) ──
    {
      id: 'layout-width-imperceptible',
      name: 'Width imperceptible shift',
      category: 'size',
      designHtml: `<html><body style="margin:0"><div id="box" style="width:200px;height:100px;background:#3B82F6"></div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="box" style="width:200px;height:100px;background:#3B82F6"></div></body></html>`,
      designState: {
        id: 'layout-width-imperceptible',
        name: 'Layout Width Imperceptible',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'box', name: 'Box', type: 'RECTANGLE', children: [],
          bounds: { x: 0, y: 0, width: 200, height: 100 },
          fills: [{ type: 'SOLID', color: '#3B82F6' }],
        }],
      },
      groundTruth: [], // No mismatch
    },

    // ── Width noticeable (3-5%) ──
    {
      id: 'layout-width-noticeable',
      name: 'Width noticeable shift',
      category: 'size',
      designHtml: `<html><body style="margin:0"><div id="box" style="width:200px;height:100px;background:#3B82F6"></div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="box" style="width:192px;height:100px;background:#3B82F6"></div></body></html>`,
      designState: {
        id: 'layout-width-noticeable',
        name: 'Layout Width Noticeable',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'box', name: 'Box', type: 'RECTANGLE', children: [],
          bounds: { x: 0, y: 0, width: 200, height: 100 },
          fills: [{ type: 'SOLID', color: '#3B82F6' }],
        }],
      },
      groundTruth: [{
        category: 'size',
        severity: 'noticeable',
        element: '#box',
        property: 'width',
        expected: '200px',
        actual: '192px',
        description: 'Width 200px vs 192px (4% off)',
      }],
    },

    // ── Width major (> 5%) ──
    {
      id: 'layout-width-major',
      name: 'Width major mismatch',
      category: 'size',
      designHtml: `<html><body style="margin:0"><div id="box" style="width:300px;height:100px;background:#3B82F6"></div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="box" style="width:200px;height:100px;background:#3B82F6"></div></body></html>`,
      designState: {
        id: 'layout-width-major',
        name: 'Layout Width Major',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'box', name: 'Box', type: 'RECTANGLE', children: [],
          bounds: { x: 0, y: 0, width: 300, height: 100 },
          fills: [{ type: 'SOLID', color: '#3B82F6' }],
        }],
      },
      groundTruth: [{
        category: 'size',
        severity: 'major',
        element: '#box',
        property: 'width',
        expected: '300px',
        actual: '200px',
        description: 'Width 300px vs 200px (33% off)',
      }],
    },

    // ── Height major ──
    {
      id: 'layout-height-major',
      name: 'Height major mismatch',
      category: 'size',
      designHtml: `<html><body style="margin:0"><div id="box" style="width:200px;height:200px;background:#3B82F6"></div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="box" style="width:200px;height:100px;background:#3B82F6"></div></body></html>`,
      designState: {
        id: 'layout-height-major',
        name: 'Layout Height Major',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'box', name: 'Box', type: 'RECTANGLE', children: [],
          bounds: { x: 0, y: 0, width: 200, height: 200 },
          fills: [{ type: 'SOLID', color: '#3B82F6' }],
        }],
      },
      groundTruth: [{
        category: 'size',
        severity: 'major',
        element: '#box',
        property: 'height',
        expected: '200px',
        actual: '100px',
        description: 'Height 200px vs 100px (50% off)',
      }],
    },

    // ── Both width and height ──
    {
      id: 'layout-both-major',
      name: 'Width and height both wrong',
      category: 'size',
      designHtml: `<html><body style="margin:0"><div id="box" style="width:300px;height:200px;background:#3B82F6"></div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="box" style="width:200px;height:100px;background:#3B82F6"></div></body></html>`,
      designState: {
        id: 'layout-both-major',
        name: 'Layout Both Major',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'box', name: 'Box', type: 'RECTANGLE', children: [],
          bounds: { x: 0, y: 0, width: 300, height: 200 },
          fills: [{ type: 'SOLID', color: '#3B82F6' }],
        }],
      },
      groundTruth: [
        {
          category: 'size',
          severity: 'major',
          element: '#box',
          property: 'width',
          expected: '300px',
          actual: '200px',
          description: 'Width 300px vs 200px',
        },
        {
          category: 'size',
          severity: 'major',
          element: '#box',
          property: 'height',
          expected: '200px',
          actual: '100px',
          description: 'Height 200px vs 100px',
        },
      ],
    },

    // ── Position offset ──
    {
      id: 'layout-position-major',
      name: 'Element positioned incorrectly',
      category: 'layout',
      designHtml: `<html><body style="margin:0"><div style="position:relative;width:400px;height:400px"><div id="box" style="position:absolute;left:50px;top:50px;width:100px;height:100px;background:#3B82F6"></div></div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div style="position:relative;width:400px;height:400px"><div id="box" style="position:absolute;left:150px;top:150px;width:100px;height:100px;background:#3B82F6"></div></div></body></html>`,
      designState: {
        id: 'layout-position-major',
        name: 'Layout Position Major',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'container', name: 'Container', type: 'FRAME', children: [{
            id: 'box', name: 'Box', type: 'RECTANGLE', children: [],
            bounds: { x: 50, y: 50, width: 100, height: 100 },
            fills: [{ type: 'SOLID', color: '#3B82F6' }],
          }],
          bounds: { x: 0, y: 0, width: 400, height: 400 },
        }],
      },
      groundTruth: [
        {
          category: 'layout',
          severity: 'major',
          element: '#box',
          property: 'x',
          expected: '50px',
          actual: '150px',
          description: 'Element x offset by 100px',
        },
        {
          category: 'layout',
          severity: 'major',
          element: '#box',
          property: 'y',
          expected: '50px',
          actual: '150px',
          description: 'Element y offset by 100px',
        },
      ],
    },
  ];
}
