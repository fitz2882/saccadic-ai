/**
 * Integration test: Full comparison pipeline E2E.
 *
 * Tests the complete flow: data URL -> screenshot -> DOM + pixel comparison -> feedback.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ComparisonEngine } from '../core/comparison-engine.js';
import type { DesignState, ComparisonResult } from '../core/types.js';

describe('Pipeline E2E Integration', () => {
  let engine: ComparisonEngine;

  beforeAll(async () => {
    engine = new ComparisonEngine();
    await engine.init();
  });

  afterAll(async () => {
    await engine.close();
  });

  it('detects matching build against design', async () => {
    const designState: DesignState = {
      id: 'test-match',
      name: 'Matching Design',
      viewport: { width: 400, height: 300 },
      nodes: [
        {
          id: 'container',
          name: 'container',
          type: 'FRAME',
          bounds: { x: 0, y: 0, width: 400, height: 300 },
          fills: [{ type: 'SOLID', color: '#FFFFFF' }],
          children: [
            {
              id: 'heading',
              name: 'heading',
              type: 'TEXT',
              bounds: { x: 20, y: 20, width: 360, height: 40 },
              typography: {
                fontFamily: 'Arial',
                fontSize: 24,
                fontWeight: 700,
                lineHeight: 32,
                color: '#000000',
              },
              children: [],
            },
          ],
        },
      ],
    };

    const buildUrl = `data:text/html,${encodeURIComponent(`
      <div style="width:400px;height:300px;background:#fff;">
        <h1 style="margin:0;padding:20px;font:700 24px/32px Arial;color:#000;">Hello World</h1>
      </div>
    `)}`;

    const result = await engine.compare({
      designSource: { designState },
      buildUrl,
      viewport: { width: 400, height: 300 },
    });

    expect(result).toHaveProperty('overall');
    expect(result).toHaveProperty('domDiff');
    expect(result).toHaveProperty('pixelDiff');
    expect(result).toHaveProperty('feedback');
    expect(result.overall.matchPercentage).toBeGreaterThan(0);
    expect(result.overall.grade).toBeDefined();
  });

  it('detects color mismatches', async () => {
    const designState: DesignState = {
      id: 'test-color',
      name: 'Color Mismatch',
      viewport: { width: 200, height: 100 },
      nodes: [
        {
          id: 'box',
          name: 'box',
          type: 'RECTANGLE',
          bounds: { x: 0, y: 0, width: 200, height: 100 },
          fills: [{ type: 'SOLID', color: '#FF0000' }],
          children: [],
        },
      ],
    };

    const buildUrl = `data:text/html,${encodeURIComponent(`
      <div style="width:200px;height:100px;background:#0000FF;"></div>
    `)}`;

    const result = await engine.compare({
      designSource: { designState },
      buildUrl,
      viewport: { width: 200, height: 100 },
    });

    const colorFeedback = result.feedback.filter((f) => f.category === 'color');
    expect(colorFeedback.length).toBeGreaterThan(0);
  });

  it('detects missing elements', async () => {
    const designState: DesignState = {
      id: 'test-missing',
      name: 'Missing Element',
      viewport: { width: 400, height: 200 },
      nodes: [
        {
          id: 'btn-submit',
          name: 'btn-submit',
          type: 'BUTTON',
          bounds: { x: 20, y: 20, width: 120, height: 40 },
          fills: [{ type: 'SOLID', color: '#0066FF' }],
          children: [],
        },
        {
          id: 'btn-cancel',
          name: 'btn-cancel',
          type: 'BUTTON',
          bounds: { x: 160, y: 20, width: 120, height: 40 },
          fills: [{ type: 'SOLID', color: '#FF0000' }],
          children: [],
        },
      ],
    };

    // Build only has one button, missing btn-cancel
    const buildUrl = `data:text/html,${encodeURIComponent(`
      <button style="position:absolute;left:20px;top:20px;width:120px;height:40px;background:#0066FF;border:none;">Submit</button>
    `)}`;

    const result = await engine.compare({
      designSource: { designState },
      buildUrl,
      viewport: { width: 400, height: 200 },
    });

    expect(result.domDiff.missing.length).toBeGreaterThan(0);
    const missingFeedback = result.feedback.filter((f) => f.category === 'missing');
    expect(missingFeedback.length).toBeGreaterThan(0);
  });

  it('returns structured ComparisonResult', async () => {
    const designState: DesignState = {
      id: 'test-structure',
      name: 'Structure Test',
      viewport: { width: 200, height: 200 },
      nodes: [],
    };

    const buildUrl = `data:text/html,${encodeURIComponent('<div></div>')}`;

    const result = await engine.compare({
      designSource: { designState },
      buildUrl,
      viewport: { width: 200, height: 200 },
    });

    // Verify result shape
    expect(result.overall).toHaveProperty('matchPercentage');
    expect(result.overall).toHaveProperty('grade');
    expect(result.overall).toHaveProperty('summary');
    expect(typeof result.overall.matchPercentage).toBe('number');
    expect(['A', 'B', 'C', 'D', 'F']).toContain(result.overall.grade);
    expect(result.domDiff).toHaveProperty('matches');
    expect(result.domDiff).toHaveProperty('mismatches');
    expect(result.domDiff).toHaveProperty('missing');
    expect(result.domDiff).toHaveProperty('extra');
    expect(result.pixelDiff).toHaveProperty('diffPercentage');
    expect(Array.isArray(result.feedback)).toBe(true);
    expect(typeof result.timestamp).toBe('number');
  });
});
