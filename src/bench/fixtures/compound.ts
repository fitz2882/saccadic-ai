/**
 * Compound test fixtures with multiple simultaneous mismatches.
 *
 * These test Saccadic AI's ability to detect and correctly categorize
 * multiple different types of issues in a single comparison.
 */

import type { TestFixture } from '../types.js';

export function getCompoundFixtures(): TestFixture[] {
  return [
    // ── Color + Spacing ──
    {
      id: 'compound-color-spacing',
      name: 'Color and spacing mismatches combined',
      category: 'color',
      designHtml: `<html><body style="margin:0"><div id="card" style="box-sizing:border-box;width:300px;padding:24px;background:#3B82F6"><p id="text" style="margin:0;font:400 16px/20px sans-serif;color:#FFFFFF">Card text</p></div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="card" style="box-sizing:border-box;width:300px;padding:8px;background:#EF4444"><p id="text" style="margin:0;font:400 16px/20px sans-serif;color:#FFFFFF">Card text</p></div></body></html>`,
      designState: {
        id: 'compound-color-spacing',
        name: 'Compound Color Spacing',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'card', name: 'Card', type: 'FRAME', children: [
            { id: 'text', name: 'Text', type: 'TEXT', children: [], bounds: { x: 24, y: 24, width: 252, height: 20 }, typography: { fontFamily: 'sans-serif', fontSize: 16, fontWeight: 400, lineHeight: 20, color: '#FFFFFF' } },
          ],
          bounds: { x: 0, y: 0, width: 300, height: 68 },
          padding: { top: 24, right: 24, bottom: 24, left: 24 },
          fills: [{ type: 'SOLID', color: '#3B82F6' }],
        }],
      },
      groundTruth: [
        {
          category: 'color',
          severity: 'major',
          element: '#card',
          property: 'backgroundColor',
          expected: '#3B82F6',
          actual: '#EF4444',
          description: 'Background blue vs red',
        },
        {
          category: 'spacing',
          severity: 'major',
          element: '#card',
          property: 'paddingTop',
          expected: '24px',
          actual: '8px',
          description: 'Padding top 24px vs 8px',
        },
        {
          category: 'spacing',
          severity: 'major',
          element: '#card',
          property: 'paddingRight',
          expected: '24px',
          actual: '8px',
          description: 'Padding right 24px vs 8px',
        },
        {
          category: 'spacing',
          severity: 'major',
          element: '#card',
          property: 'paddingBottom',
          expected: '24px',
          actual: '8px',
          description: 'Padding bottom 24px vs 8px',
        },
        {
          category: 'spacing',
          severity: 'major',
          element: '#card',
          property: 'paddingLeft',
          expected: '24px',
          actual: '8px',
          description: 'Padding left 24px vs 8px',
        },
      ],
    },

    // ── Typography + Size + Color ──
    {
      id: 'compound-typo-size-color',
      name: 'Typography, size, and color all wrong',
      category: 'typography',
      designHtml: `<html><body style="margin:0"><div id="banner" style="width:400px;height:120px;background:#1E40AF;display:flex;align-items:center;justify-content:center"><h1 id="title" style="margin:0;font:700 32px/40px sans-serif;color:#FFFFFF">Welcome</h1></div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="banner" style="width:300px;height:80px;background:#6B7280;display:flex;align-items:center;justify-content:center"><h1 id="title" style="margin:0;font:400 18px/24px sans-serif;color:#D1D5DB">Welcome</h1></div></body></html>`,
      designState: {
        id: 'compound-typo-size-color',
        name: 'Compound Typo Size Color',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'banner', name: 'Banner', type: 'FRAME', children: [
            { id: 'title', name: 'Title', type: 'TEXT', children: [], bounds: { x: 100, y: 40, width: 200, height: 40 }, typography: { fontFamily: 'sans-serif', fontSize: 32, fontWeight: 700, color: '#FFFFFF' } },
          ],
          bounds: { x: 0, y: 0, width: 400, height: 120 },
          fills: [{ type: 'SOLID', color: '#1E40AF' }],
        }],
      },
      groundTruth: [
        {
          category: 'color',
          severity: 'major',
          element: '#banner',
          property: 'backgroundColor',
          expected: '#1E40AF',
          actual: '#6B7280',
          description: 'Banner bg blue vs gray',
        },
        {
          category: 'size',
          severity: 'major',
          element: '#banner',
          property: 'width',
          expected: '400px',
          actual: '300px',
          description: 'Banner width 400 vs 300',
        },
        {
          category: 'size',
          severity: 'major',
          element: '#banner',
          property: 'height',
          expected: '120px',
          actual: '80px',
          description: 'Banner height 120 vs 80',
        },
        {
          category: 'typography',
          severity: 'major',
          element: '#title',
          property: 'fontSize',
          expected: '32px',
          actual: '18px',
          description: 'Title font 32px vs 18px',
        },
        {
          category: 'typography',
          severity: 'major',
          element: '#title',
          property: 'fontWeight',
          expected: '700',
          actual: '400',
          description: 'Title weight bold vs normal',
        },
        {
          category: 'color',
          severity: 'major',
          element: '#title',
          property: 'color',
          expected: '#FFFFFF',
          actual: '#D1D5DB',
          description: 'Title color white vs light gray',
        },
      ],
    },

    // ── Missing + Color + Typography ──
    {
      id: 'compound-missing-color-typo',
      name: 'Missing element plus color and typography issues',
      category: 'missing',
      designHtml: `<html><body style="margin:0"><div id="card" style="box-sizing:border-box;width:300px;padding:16px;background:#FFFFFF"><h3 id="heading" style="margin:0 0 8px 0;font:700 20px/26px sans-serif;color:#1F2937">Title</h3><p id="body" style="margin:0 0 16px 0;font:400 14px/20px sans-serif;color:#6B7280">Body text</p><a id="link" style="font:400 14px/20px sans-serif;color:#3B82F6;text-decoration:none">Read more</a></div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="card" style="box-sizing:border-box;width:300px;padding:16px;background:#F9FAFB"><h3 id="heading" style="margin:0 0 8px 0;font:400 16px/20px sans-serif;color:#1F2937">Title</h3><p id="body" style="margin:0 0 16px 0;font:400 14px/20px sans-serif;color:#6B7280">Body text</p></div></body></html>`,
      designState: {
        id: 'compound-missing-color-typo',
        name: 'Compound Missing Color Typo',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'card', name: 'Card', type: 'FRAME', children: [
            { id: 'heading', name: 'Heading', type: 'TEXT', children: [], bounds: { x: 16, y: 16, width: 268, height: 26 }, typography: { fontFamily: 'sans-serif', fontSize: 20, fontWeight: 700, lineHeight: 26, color: '#1F2937' } },
            { id: 'body', name: 'Body', type: 'TEXT', children: [], bounds: { x: 16, y: 50, width: 268, height: 20 }, typography: { fontFamily: 'sans-serif', fontSize: 14, fontWeight: 400, lineHeight: 20, color: '#6B7280' } },
            { id: 'link', name: 'Read More Link', type: 'TEXT', children: [], bounds: { x: 16, y: 86, width: 80, height: 20 }, typography: { fontFamily: 'sans-serif', fontSize: 14, fontWeight: 400, lineHeight: 20, color: '#3B82F6' } },
          ],
          bounds: { x: 0, y: 0, width: 300, height: 122 },
          padding: { top: 16, right: 16, bottom: 16, left: 16 },
          fills: [{ type: 'SOLID', color: '#FFFFFF' }],
        }],
      },
      groundTruth: [
        {
          category: 'color',
          severity: 'noticeable',
          element: '#card',
          property: 'backgroundColor',
          expected: '#FFFFFF',
          actual: '#F9FAFB',
          description: 'Card bg white vs near-white',
        },
        {
          category: 'typography',
          severity: 'major',
          element: '#heading',
          property: 'fontSize',
          expected: '20px',
          actual: '16px',
          description: 'Heading font 20px vs 16px',
        },
        {
          category: 'typography',
          severity: 'major',
          element: '#heading',
          property: 'fontWeight',
          expected: '700',
          actual: '400',
          description: 'Heading weight bold vs normal',
        },
        {
          category: 'typography',
          severity: 'major',
          element: '#heading',
          property: 'lineHeight',
          expected: '26px',
          actual: '20px',
          description: 'Heading lineHeight 26px vs 20px',
        },
        {
          category: 'missing',
          severity: 'major',
          element: 'Read More Link',
          property: 'element',
          expected: 'present',
          actual: 'absent',
          description: 'Read more link missing from build',
        },
      ],
    },

    // ── Full-page compound: everything wrong ──
    {
      id: 'compound-everything',
      name: 'Every category has issues',
      category: 'color',
      designHtml: `<html><body style="margin:0"><div id="page" style="width:400px"><div id="nav" style="box-sizing:border-box;width:400px;height:50px;padding:0 16px;background:#1E40AF;display:flex;align-items:center"><span id="logo" style="font:700 20px/30px sans-serif;color:#FFFFFF">Logo</span></div><div id="main" style="box-sizing:border-box;width:400px;padding:24px"><h1 id="title" style="margin:0 0 16px 0;font:700 28px/36px sans-serif">Page Title</h1><p id="intro" style="margin:0 0 24px 0;font:400 16px/20px sans-serif">Intro text</p><button id="cta" style="padding:12px 24px;background:#3B82F6;color:white;border:none;border-radius:6px;font:400 16px/20px sans-serif">Get Started</button></div></div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="page" style="width:350px"><div id="nav" style="box-sizing:border-box;width:350px;height:40px;padding:0 8px;background:#6B7280;display:flex;align-items:center"><span id="logo" style="font:400 14px/20px sans-serif;color:#D1D5DB">Logo</span></div><div id="main" style="box-sizing:border-box;width:350px;padding:8px"><h1 id="title" style="margin:0 0 8px 0;font:400 20px/26px sans-serif">Page Title</h1><p id="intro" style="margin:0 0 24px 0;font:400 14px/20px sans-serif">Intro text</p></div></div></body></html>`,
      designState: {
        id: 'compound-everything',
        name: 'Compound Everything',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'page', name: 'Page', type: 'FRAME', children: [
            {
              id: 'nav', name: 'Nav', type: 'FRAME', children: [
                { id: 'logo', name: 'Logo', type: 'TEXT', children: [], bounds: { x: 16, y: 10, width: 60, height: 30 }, typography: { fontFamily: 'sans-serif', fontSize: 20, fontWeight: 700, lineHeight: 30, color: '#FFFFFF' } },
              ],
              bounds: { x: 0, y: 0, width: 400, height: 50 },
              padding: { top: 0, right: 16, bottom: 0, left: 16 },
              fills: [{ type: 'SOLID', color: '#1E40AF' }],
            },
            {
              id: 'main', name: 'Main', type: 'FRAME', children: [
                { id: 'title', name: 'Page Title', type: 'TEXT', children: [], bounds: { x: 24, y: 74, width: 352, height: 36 }, typography: { fontFamily: 'sans-serif', fontSize: 28, fontWeight: 700, lineHeight: 36 } },
                { id: 'intro', name: 'Intro', type: 'TEXT', children: [], bounds: { x: 24, y: 126, width: 352, height: 20 }, typography: { fontFamily: 'sans-serif', fontSize: 16, fontWeight: 400, lineHeight: 20 } },
                { id: 'cta', name: 'CTA Button', type: 'BUTTON', children: [], bounds: { x: 24, y: 170, width: 140, height: 44 }, fills: [{ type: 'SOLID', color: '#3B82F6' }] },
              ],
              bounds: { x: 0, y: 50, width: 400, height: 190 },
              padding: { top: 24, right: 24, bottom: 24, left: 24 },
            },
          ],
          bounds: { x: 0, y: 0, width: 400, height: 240 },
        }],
      },
      groundTruth: [
        { category: 'size', severity: 'major', element: '#page', property: 'width', expected: '400px', actual: '350px', description: 'Page width 400 vs 350' },
        { category: 'color', severity: 'major', element: '#nav', property: 'backgroundColor', expected: '#1E40AF', actual: '#6B7280', description: 'Nav bg blue vs gray' },
        { category: 'size', severity: 'major', element: '#nav', property: 'height', expected: '50px', actual: '40px', description: 'Nav height 50 vs 40' },
        { category: 'spacing', severity: 'major', element: '#nav', property: 'paddingRight', expected: '16px', actual: '8px', description: 'Nav padding-right 16 vs 8' },
        { category: 'spacing', severity: 'major', element: '#nav', property: 'paddingLeft', expected: '16px', actual: '8px', description: 'Nav padding-left 16 vs 8' },
        { category: 'typography', severity: 'major', element: '#logo', property: 'fontSize', expected: '20px', actual: '14px', description: 'Logo font 20 vs 14' },
        { category: 'typography', severity: 'major', element: '#logo', property: 'fontWeight', expected: '700', actual: '400', description: 'Logo weight bold vs normal' },
        { category: 'typography', severity: 'major', element: '#logo', property: 'lineHeight', expected: '30px', actual: '20px', description: 'Logo lineHeight 30 vs 20' },
        { category: 'color', severity: 'major', element: '#logo', property: 'color', expected: '#FFFFFF', actual: '#D1D5DB', description: 'Logo color white vs gray' },
        { category: 'spacing', severity: 'major', element: '#main', property: 'paddingTop', expected: '24px', actual: '8px', description: 'Main padding-top 24 vs 8' },
        { category: 'spacing', severity: 'major', element: '#main', property: 'paddingRight', expected: '24px', actual: '8px', description: 'Main padding-right 24 vs 8' },
        { category: 'spacing', severity: 'major', element: '#main', property: 'paddingBottom', expected: '24px', actual: '8px', description: 'Main padding-bottom 24 vs 8' },
        { category: 'spacing', severity: 'major', element: '#main', property: 'paddingLeft', expected: '24px', actual: '8px', description: 'Main padding-left 24 vs 8' },
        { category: 'typography', severity: 'major', element: '#title', property: 'fontSize', expected: '28px', actual: '20px', description: 'Title font 28 vs 20' },
        { category: 'typography', severity: 'major', element: '#title', property: 'fontWeight', expected: '700', actual: '400', description: 'Title weight bold vs normal' },
        { category: 'typography', severity: 'major', element: '#title', property: 'lineHeight', expected: '36px', actual: '26px', description: 'Title lineHeight 36 vs 26' },
        { category: 'typography', severity: 'major', element: '#intro', property: 'fontSize', expected: '16px', actual: '14px', description: 'Intro fontSize 16 vs 14' },
        { category: 'missing', severity: 'major', element: 'CTA Button', property: 'element', expected: 'present', actual: 'absent', description: 'CTA button missing' },
      ],
    },
  ];
}
