/**
 * Color mismatch test fixtures.
 *
 * Tests background-color and text color mismatches at three severity levels
 * using deltaE perceptual color distance.
 */

import type { TestFixture } from '../types.js';

export function getColorFixtures(): TestFixture[] {
  return [
    // ── Imperceptible (deltaE < 1) ──
    {
      id: 'color-bg-imperceptible',
      name: 'Background color imperceptible shift',
      category: 'color',
      designHtml: `<html><body style="margin:0"><div id="card" style="width:200px;height:100px;background-color:#3B82F6"></div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="card" style="width:200px;height:100px;background-color:#3A82F7"></div></body></html>`,
      designState: {
        id: 'color-bg-imperceptible',
        name: 'Color BG Imperceptible',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'card', name: 'Card', type: 'RECTANGLE', children: [],
          bounds: { x: 0, y: 0, width: 200, height: 100 },
          fills: [{ type: 'SOLID', color: '#3B82F6' }],
        }],
      },
      groundTruth: [], // deltaE < 1 — imperceptible, not expected to be detected
    },

    // ── Noticeable (deltaE 1-2) ──
    {
      id: 'color-bg-noticeable',
      name: 'Background color noticeable shift',
      category: 'color',
      designHtml: `<html><body style="margin:0"><div id="card" style="width:200px;height:100px;background-color:#3B82F6"></div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="card" style="width:200px;height:100px;background-color:#3080EE"></div></body></html>`,
      designState: {
        id: 'color-bg-noticeable',
        name: 'Color BG Noticeable',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'card', name: 'Card', type: 'RECTANGLE', children: [],
          bounds: { x: 0, y: 0, width: 200, height: 100 },
          fills: [{ type: 'SOLID', color: '#3B82F6' }],
        }],
      },
      groundTruth: [{
        category: 'color',
        severity: 'noticeable',
        element: '#card',
        property: 'backgroundColor',
        expected: '#3B82F6',
        actual: '#3080EE',
        description: 'Background color shift deltaE ~1.5',
      }],
    },

    // ── Major (deltaE > 2) ──
    {
      id: 'color-bg-major',
      name: 'Background color major mismatch',
      category: 'color',
      designHtml: `<html><body style="margin:0"><div id="card" style="width:200px;height:100px;background-color:#3B82F6"></div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="card" style="width:200px;height:100px;background-color:#EF4444"></div></body></html>`,
      designState: {
        id: 'color-bg-major',
        name: 'Color BG Major',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'card', name: 'Card', type: 'RECTANGLE', children: [],
          bounds: { x: 0, y: 0, width: 200, height: 100 },
          fills: [{ type: 'SOLID', color: '#3B82F6' }],
        }],
      },
      groundTruth: [{
        category: 'color',
        severity: 'major',
        element: '#card',
        property: 'backgroundColor',
        expected: '#3B82F6',
        actual: '#EF4444',
        description: 'Background color completely wrong (blue vs red)',
      }],
    },

    // ── Text color major ──
    {
      id: 'color-text-major',
      name: 'Text color major mismatch',
      category: 'color',
      designHtml: `<html><body style="margin:0"><p id="heading" style="margin:0;font:400 24px/30px serif;color:#1F2937">Hello</p></body></html>`,
      buildHtml: `<html><body style="margin:0"><p id="heading" style="margin:0;font:400 24px/30px serif;color:#9CA3AF">Hello</p></body></html>`,
      designState: {
        id: 'color-text-major',
        name: 'Color Text Major',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'heading', name: 'Heading', type: 'TEXT', children: [],
          bounds: { x: 0, y: 0, width: 800, height: 30 },
          typography: { fontFamily: 'serif', fontSize: 24, fontWeight: 400, lineHeight: 30, color: '#1F2937' },
        }],
      },
      groundTruth: [{
        category: 'color',
        severity: 'major',
        element: '#heading',
        property: 'color',
        expected: '#1F2937',
        actual: '#9CA3AF',
        description: 'Text color dark gray vs light gray',
      }],
    },

    // ── Multiple color mismatches ──
    {
      id: 'color-multi',
      name: 'Multiple color mismatches on one page',
      category: 'color',
      designHtml: `<html><body style="margin:0"><div id="header" style="width:400px;height:60px;background-color:#1E40AF"><span id="title" style="font:400 20px/24px sans-serif;color:#FFFFFF">Title</span></div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="header" style="width:400px;height:60px;background-color:#7C3AED"><span id="title" style="font:400 20px/24px sans-serif;color:#F3F4F6">Title</span></div></body></html>`,
      designState: {
        id: 'color-multi',
        name: 'Color Multi',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'header', name: 'Header', type: 'FRAME', children: [{
            id: 'title', name: 'Title', type: 'TEXT', children: [],
            bounds: { x: 0, y: 0, width: 38, height: 23 },
            typography: { fontFamily: 'sans-serif', fontSize: 20, fontWeight: 400, lineHeight: 24, color: '#FFFFFF' },
          }],
          bounds: { x: 0, y: 0, width: 400, height: 60 },
          fills: [{ type: 'SOLID', color: '#1E40AF' }],
        }],
      },
      groundTruth: [
        {
          category: 'color',
          severity: 'major',
          element: '#header',
          property: 'backgroundColor',
          expected: '#1E40AF',
          actual: '#7C3AED',
          description: 'Header bg blue vs purple',
        },
        {
          category: 'color',
          severity: 'noticeable',
          element: '#title',
          property: 'color',
          expected: '#FFFFFF',
          actual: '#F3F4F6',
          description: 'Title text white vs near-white',
        },
      ],
    },
  ];
}
