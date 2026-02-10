/**
 * Missing/extra element test fixtures.
 *
 * Tests elements that are absent from the build or present but not in the design.
 */

import type { TestFixture } from '../types.js';

export function getElementFixtures(): TestFixture[] {
  return [
    // ── Missing element ──
    {
      id: 'element-missing-button',
      name: 'Missing button element',
      category: 'missing',
      designHtml: `<html><body style="margin:0"><div id="card" style="box-sizing:border-box;width:300px;padding:16px;background:#F3F4F6;font-family:sans-serif"><h2 id="title" style="margin:0 0 8px 0;font:400 18px/22px sans-serif">Card Title</h2><p id="desc" style="margin:0 0 16px 0;font:400 14px/17px sans-serif">Description text</p><button id="action" style="padding:8px 16px;background:#3B82F6;color:white;border:none;border-radius:4px;font-family:sans-serif">Click me</button></div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="card" style="box-sizing:border-box;width:300px;padding:16px;background:#F3F4F6;font-family:sans-serif"><h2 id="title" style="margin:0 0 8px 0;font:400 18px/22px sans-serif">Card Title</h2><p id="desc" style="margin:0 0 16px 0;font:400 14px/17px sans-serif">Description text</p></div></body></html>`,
      designState: {
        id: 'element-missing-button',
        name: 'Element Missing Button',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'card', name: 'Card', type: 'FRAME', children: [
            { id: 'title', name: 'Title', type: 'TEXT', children: [], bounds: { x: 16, y: 16, width: 268, height: 22 }, typography: { fontFamily: 'sans-serif', fontSize: 18, fontWeight: 400, lineHeight: 22 } },
            { id: 'desc', name: 'Description', type: 'TEXT', children: [], bounds: { x: 16, y: 46, width: 268, height: 17 }, typography: { fontFamily: 'sans-serif', fontSize: 14, fontWeight: 400, lineHeight: 17 } },
            { id: 'action', name: 'Action Button', type: 'BUTTON', children: [], bounds: { x: 16, y: 79, width: 100, height: 36 }, fills: [{ type: 'SOLID', color: '#3B82F6' }] },
          ],
          bounds: { x: 0, y: 0, width: 300, height: 131 },
          padding: { top: 16, right: 16, bottom: 16, left: 16 },
          fills: [{ type: 'SOLID', color: '#F3F4F6' }],
        }],
      },
      groundTruth: [{
        category: 'missing',
        severity: 'major',
        element: 'Action Button',
        property: 'element',
        expected: 'present',
        actual: 'absent',
        description: 'Button element missing from build',
      }],
    },

    // ── Missing image ──
    {
      id: 'element-missing-image',
      name: 'Missing image element',
      category: 'missing',
      designHtml: `<html><body style="margin:0"><div id="card" style="width:300px"><div id="hero" style="width:300px;height:200px;background:#D1D5DB"></div><p id="caption" style="margin:8px 8px 0 8px;font:400 14px/20px sans-serif">Image caption</p></div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="card" style="width:300px"><p id="caption" style="margin:8px 8px 0 8px;font:400 14px/20px sans-serif">Image caption</p></div></body></html>`,
      designState: {
        id: 'element-missing-image',
        name: 'Element Missing Image',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'card', name: 'Card', type: 'FRAME', children: [
            { id: 'hero', name: 'Hero Image', type: 'IMAGE', children: [], bounds: { x: 0, y: 0, width: 300, height: 200 } },
            { id: 'caption', name: 'Caption', type: 'TEXT', children: [], bounds: { x: 8, y: 208, width: 284, height: 20 }, typography: { fontFamily: 'sans-serif', fontSize: 14, fontWeight: 400, lineHeight: 20 } },
          ],
          bounds: { x: 0, y: 0, width: 300, height: 228 },
        }],
      },
      groundTruth: [{
        category: 'missing',
        severity: 'major',
        element: 'Hero Image',
        property: 'element',
        expected: 'present',
        actual: 'absent',
        description: 'Hero image element missing from build',
      }],
    },

    // ── Extra decorative element ──
    {
      id: 'element-extra-decorative',
      name: 'Extra decorative element',
      category: 'extra',
      designHtml: `<html><body style="margin:0"><div id="card" style="box-sizing:border-box;width:300px;padding:16px;background:#F3F4F6"><h2 id="title" style="margin:0;font:400 18px/24px sans-serif">Title</h2></div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="card" style="box-sizing:border-box;width:300px;padding:16px;background:#F3F4F6"><div id="badge" style="width:60px;height:20px;background:#10B981;border-radius:10px"></div><h2 id="title" style="margin:0;font:400 18px/24px sans-serif">Title</h2></div></body></html>`,
      designState: {
        id: 'element-extra-decorative',
        name: 'Element Extra Decorative',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'card', name: 'Card', type: 'FRAME', children: [
            { id: 'title', name: 'Title', type: 'TEXT', children: [], bounds: { x: 16, y: 16, width: 268, height: 24 }, typography: { fontFamily: 'sans-serif', fontSize: 18, fontWeight: 400, lineHeight: 24 } },
          ],
          bounds: { x: 0, y: 0, width: 300, height: 56 },
          padding: { top: 16, right: 16, bottom: 16, left: 16 },
          fills: [{ type: 'SOLID', color: '#F3F4F6' }],
        }],
      },
      groundTruth: [{
        category: 'extra',
        severity: 'noticeable',
        element: '#badge',
        property: 'element',
        expected: 'absent',
        actual: 'present',
        description: 'Extra badge element not in design',
      }],
    },

    // ── Extra structural element ──
    {
      id: 'element-extra-structural',
      name: 'Extra structural element (extra section)',
      category: 'extra',
      designHtml: `<html><body style="margin:0"><div id="page"><div id="header" style="height:60px;background:#1E40AF"></div><div id="content" style="height:400px;background:#FFFFFF"></div></div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="page"><div id="header" style="height:60px;background:#1E40AF"></div><div id="sidebar" style="width:200px;height:400px;background:#F3F4F6;float:left"></div><div id="content" style="height:400px;background:#FFFFFF"></div></div></body></html>`,
      designState: {
        id: 'element-extra-structural',
        name: 'Element Extra Structural',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'page', name: 'Page', type: 'FRAME', children: [
            { id: 'header', name: 'Header', type: 'FRAME', children: [], bounds: { x: 0, y: 0, width: 800, height: 60 }, fills: [{ type: 'SOLID', color: '#1E40AF' }] },
            { id: 'content', name: 'Content', type: 'FRAME', children: [], bounds: { x: 0, y: 60, width: 800, height: 400 }, fills: [{ type: 'SOLID', color: '#FFFFFF' }] },
          ],
          bounds: { x: 0, y: 0, width: 800, height: 460 },
        }],
      },
      groundTruth: [{
        category: 'extra',
        severity: 'major',
        element: '#sidebar',
        property: 'element',
        expected: 'absent',
        actual: 'present',
        description: 'Extra sidebar element not in design',
      }],
    },

    // ── Multiple missing elements ──
    {
      id: 'element-multi-missing',
      name: 'Multiple missing elements',
      category: 'missing',
      designHtml: `<html><body style="margin:0"><div id="form" style="box-sizing:border-box;width:300px;padding:16px"><input id="email" style="box-sizing:border-box;width:268px;height:36px;margin:0 0 8px 0;padding:8px;border:1px solid #D1D5DB;font:400 14px sans-serif" placeholder="Email"><input id="password" style="box-sizing:border-box;width:268px;height:36px;margin:0 0 16px 0;padding:8px;border:1px solid #D1D5DB;font:400 14px sans-serif" placeholder="Password" type="password"><button id="submit" style="box-sizing:border-box;width:268px;height:40px;background:#3B82F6;color:white;border:none;border-radius:4px;font:400 14px sans-serif">Submit</button></div></body></html>`,
      buildHtml: `<html><body style="margin:0"><div id="form" style="box-sizing:border-box;width:300px;padding:16px"><input id="email" style="box-sizing:border-box;width:268px;height:36px;margin:0;padding:8px;border:1px solid #D1D5DB;font:400 14px sans-serif" placeholder="Email"></div></body></html>`,
      designState: {
        id: 'element-multi-missing',
        name: 'Element Multi Missing',
        viewport: { width: 800, height: 600 },
        nodes: [{
          id: 'form', name: 'Form', type: 'FRAME', children: [
            { id: 'email', name: 'Email Input', type: 'INPUT', children: [], bounds: { x: 16, y: 16, width: 268, height: 36 } },
            { id: 'password', name: 'Password Input', type: 'INPUT', children: [], bounds: { x: 16, y: 60, width: 268, height: 36 } },
            { id: 'submit', name: 'Submit Button', type: 'BUTTON', children: [], bounds: { x: 16, y: 112, width: 268, height: 40 }, fills: [{ type: 'SOLID', color: '#3B82F6' }] },
          ],
          bounds: { x: 0, y: 0, width: 300, height: 168 },
          padding: { top: 16, right: 16, bottom: 16, left: 16 },
        }],
      },
      groundTruth: [
        {
          category: 'missing',
          severity: 'major',
          element: 'Password Input',
          property: 'element',
          expected: 'present',
          actual: 'absent',
          description: 'Password input missing from build',
        },
        {
          category: 'missing',
          severity: 'major',
          element: 'Submit Button',
          property: 'element',
          expected: 'present',
          actual: 'absent',
          description: 'Submit button missing from build',
        },
      ],
    },
  ];
}
