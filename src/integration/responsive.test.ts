/**
 * Integration test: Responsive multi-viewport testing.
 *
 * Tests comparison across mobile, tablet, and desktop viewports.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ComparisonEngine } from '../core/comparison-engine.js';
import type { DesignState, Viewport } from '../core/types.js';

describe('Responsive Multi-Viewport Integration', () => {
  let engine: ComparisonEngine;

  beforeAll(async () => {
    engine = new ComparisonEngine();
    await engine.init();
  });

  afterAll(async () => {
    await engine.close();
  });

  it('runs comparison at multiple viewports', async () => {
    const designState: DesignState = {
      id: 'responsive-test',
      name: 'Responsive Design',
      viewport: { width: 1280, height: 800 },
      nodes: [
        {
          id: 'header',
          name: 'header',
          type: 'FRAME',
          bounds: { x: 0, y: 0, width: 1280, height: 60 },
          fills: [{ type: 'SOLID', color: '#333333' }],
          children: [],
        },
      ],
    };

    const buildUrl = `data:text/html,${encodeURIComponent(`
      <header style="width:100%;height:60px;background:#333;"></header>
    `)}`;

    const viewports: Viewport[] = [
      { width: 375, height: 812 },   // mobile
      { width: 768, height: 1024 },  // tablet
      { width: 1280, height: 800 },  // desktop
    ];

    const results = await engine.compareMultiViewport(
      { designSource: { designState }, buildUrl },
      viewports
    );

    expect(results.size).toBe(3);
    expect(results.has('375x812')).toBe(true);
    expect(results.has('768x1024')).toBe(true);
    expect(results.has('1280x800')).toBe(true);

    // Each result should be a valid ComparisonResult
    for (const [key, result] of results) {
      expect(result.overall).toHaveProperty('matchPercentage');
      expect(result.overall).toHaveProperty('grade');
      expect(result.domDiff).toHaveProperty('matches');
      expect(typeof result.timestamp).toBe('number');
    }
  });

  it('detects viewport-specific issues', async () => {
    const designState: DesignState = {
      id: 'responsive-size',
      name: 'Responsive Size',
      viewport: { width: 375, height: 812 },
      nodes: [
        {
          id: 'box',
          name: 'box',
          type: 'RECTANGLE',
          bounds: { x: 0, y: 0, width: 375, height: 100 },
          fills: [{ type: 'SOLID', color: '#0066FF' }],
          children: [],
        },
      ],
    };

    // Build has wrong color — should be detected at any viewport
    const buildUrl = `data:text/html,${encodeURIComponent(`
      <div style="width:375px;height:100px;background:#FF0000;"></div>
    `)}`;

    const result = await engine.compare({
      designSource: { designState },
      buildUrl,
      viewport: { width: 375, height: 812 },
    });

    // Should detect color mismatch
    const issues = result.feedback.filter((f) => f.severity === 'fail' || f.severity === 'warn');
    expect(issues.length).toBeGreaterThan(0);
  });
});
