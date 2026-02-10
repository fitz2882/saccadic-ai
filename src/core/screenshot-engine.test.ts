/**
 * Screenshot Engine Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ScreenshotEngine } from './screenshot-engine.js';

describe('ScreenshotEngine', () => {
  let engine: ScreenshotEngine;

  beforeAll(async () => {
    engine = new ScreenshotEngine();
    await engine.init();
  });

  afterAll(async () => {
    await engine.close();
  });

  it('should initialize and close cleanly', async () => {
    const tempEngine = new ScreenshotEngine();
    await tempEngine.init();
    await tempEngine.close();
    // Should not throw
    expect(true).toBe(true);
  });

  it('should capture a screenshot from a data URL', async () => {
    const dataUrl = 'data:text/html,<html><body><div style="width:100px;height:100px;background:red"></div></body></html>';

    const result = await engine.capture({
      url: dataUrl,
      viewport: { width: 800, height: 600 },
    });

    expect(result.image).toBeInstanceOf(Buffer);
    expect(result.image.length).toBeGreaterThan(0);
    expect(result.viewport).toEqual({ width: 800, height: 600 });
    expect(result.url).toBe(dataUrl);
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it('should extract DOM styles with expected properties', async () => {
    const dataUrl = 'data:text/html,<html><body><div id="test" style="width:100px;height:100px;background:red;color:white;font-size:16px"></div></body></html>';

    const result = await engine.capture({
      url: dataUrl,
      viewport: { width: 800, height: 600 },
    });

    expect(result.domStyles).toBeDefined();
    expect(result.domStyles!.length).toBeGreaterThan(0);

    // Find the test div
    const testDiv = result.domStyles!.find(style => style.selector.includes('test'));
    expect(testDiv).toBeDefined();
    expect(testDiv!.tagName).toBe('div');
    expect(testDiv!.computedStyles).toHaveProperty('color');
    expect(testDiv!.computedStyles).toHaveProperty('backgroundColor');
    expect(testDiv!.computedStyles).toHaveProperty('fontSize');
    expect(testDiv!.computedStyles).toHaveProperty('fontWeight');
    expect(testDiv!.computedStyles).toHaveProperty('width');
    expect(testDiv!.computedStyles).toHaveProperty('height');
    expect(testDiv!.bounds.width).toBeGreaterThan(0);
    expect(testDiv!.bounds.height).toBeGreaterThan(0);
  });

  it('should extract element bounds', async () => {
    const dataUrl = 'data:text/html,<html><body><div id="box1" style="width:100px;height:50px"></div><div id="box2" style="width:200px;height:75px"></div></body></html>';

    const result = await engine.capture({
      url: dataUrl,
      viewport: { width: 800, height: 600 },
    });

    expect(result.elementBounds).toBeDefined();
    expect(result.elementBounds!.length).toBeGreaterThan(0);

    // Find the boxes
    const box1 = result.elementBounds!.find(el => el.selector.includes('box1'));
    const box2 = result.elementBounds!.find(el => el.selector.includes('box2'));

    expect(box1).toBeDefined();
    expect(box1!.bounds.width).toBeGreaterThan(0);
    expect(box1!.bounds.height).toBeGreaterThan(0);

    expect(box2).toBeDefined();
    expect(box2!.bounds.width).toBeGreaterThan(0);
    expect(box2!.bounds.height).toBeGreaterThan(0);
  });

  it('should capture element-scoped screenshot with selector', async () => {
    const dataUrl = 'data:text/html,<html><body><div id="target" style="width:100px;height:100px;background:blue"></div><div style="width:200px;height:200px;background:green"></div></body></html>';

    const result = await engine.capture({
      url: dataUrl,
      viewport: { width: 800, height: 600 },
      selector: '#target',
    });

    expect(result.image).toBeInstanceOf(Buffer);
    expect(result.image.length).toBeGreaterThan(0);
    expect(result.selector).toBe('#target');
  });

  it('should configure viewport correctly', async () => {
    const dataUrl = 'data:text/html,<html><body><div style="width:100%;height:100%;background:purple"></div></body></html>';

    const customViewport = { width: 1024, height: 768, deviceScaleFactor: 2 };
    const result = await engine.capture({
      url: dataUrl,
      viewport: customViewport,
    });

    expect(result.viewport).toEqual(customViewport);
  });

  it('should disable animations by default', async () => {
    const dataUrl = 'data:text/html,<html><body><div id="animated" style="width:100px;height:100px;background:red;transition:all 1s"></div></body></html>';

    const result = await engine.capture({
      url: dataUrl,
      viewport: { width: 800, height: 600 },
    });

    expect(result.image).toBeInstanceOf(Buffer);
    // The test passes if no timeout occurs (animations are disabled)
  });

  it('should wait for selector when specified', async () => {
    const dataUrl = 'data:text/html,<html><body><div id="late-element" style="width:100px;height:100px;background:orange"></div></body></html>';

    const result = await engine.capture({
      url: dataUrl,
      viewport: { width: 800, height: 600 },
      waitForSelector: '#late-element',
    });

    expect(result.image).toBeInstanceOf(Buffer);
    expect(result.domStyles!.some(s => s.selector.includes('late-element'))).toBe(true);
  });

  it('should support fullPage option', async () => {
    const dataUrl = 'data:text/html,<html><body><div style="height:2000px;background:linear-gradient(red,blue)"></div></body></html>';

    const result = await engine.capture({
      url: dataUrl,
      viewport: { width: 800, height: 600 },
      fullPage: true,
    });

    expect(result.image).toBeInstanceOf(Buffer);
    expect(result.image.length).toBeGreaterThan(0);
  });
});
