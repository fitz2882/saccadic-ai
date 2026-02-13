/**
 * Screenshot Engine
 *
 * Captures screenshots and extracts DOM metadata using Playwright.
 */

import { chromium, Browser, Page } from 'playwright';
import type {
  ScreenshotOptions,
  ScreenshotResult,
  DOMElementStyle,
  ElementBounds,
  Viewport,
  Bounds,
} from './types.js';

export class ScreenshotEngine {
  private browser: Browser | null = null;

  /**
   * Initialize the browser instance.
   * Called lazily on first capture if not already initialized.
   */
  async init(): Promise<void> {
    if (this.browser) {
      return;
    }

    this.browser = await chromium.launch({
      headless: true,
    });
  }

  /**
   * Capture a screenshot from the specified URL with optional configuration.
   */
  async capture(options: ScreenshotOptions): Promise<ScreenshotResult> {
    // Ensure browser is initialized
    await this.init();

    if (!this.browser) {
      throw new Error('Browser failed to initialize');
    }

    // Create a new browser context and page
    const viewport: Viewport = options.viewport || { width: 1280, height: 800 };
    const context = await this.browser.newContext({
      viewport: {
        width: viewport.width,
        height: viewport.height,
      },
      deviceScaleFactor: viewport.deviceScaleFactor || 1,
    });

    const page = await context.newPage();

    try {
      // Navigate to URL
      await page.goto(options.url, { waitUntil: 'networkidle' });

      // Disable animations if requested (default: true)
      if (options.disableAnimations !== false) {
        await this.disableAnimations(page);
      }

      // Wait for custom selector if provided
      if (options.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, { timeout: 30000 });
      }

      // Wait for custom timeout if provided
      if (options.waitForTimeout) {
        await page.waitForTimeout(options.waitForTimeout);
      }

      // Extract DOM styles and element bounds
      const domStyles = await this.extractDOMStyles(page);
      const elementBounds = await this.extractElementBounds(page);

      // Capture screenshot
      let image: Buffer;

      if (options.selector) {
        // Element-scoped screenshot
        const locator = page.locator(options.selector);
        const buffer = await locator.screenshot();
        image = Buffer.from(buffer);
      } else {
        // Full page or viewport screenshot
        const buffer = await page.screenshot({
          fullPage: options.fullPage || false,
          type: 'png',
        });
        image = Buffer.from(buffer);
      }

      return {
        image,
        viewport,
        url: options.url,
        selector: options.selector,
        timestamp: Date.now(),
        domStyles,
        elementBounds,
      };
    } finally {
      await context.close();
    }
  }

  /**
   * Disable CSS animations and transitions to ensure consistent screenshots.
   */
  private async disableAnimations(page: Page): Promise<void> {
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
          scroll-behavior: auto !important;
        }
      `,
    });
  }

  /**
   * Extract computed styles for all visible elements.
   */
  async extractDOMStyles(page: Page): Promise<DOMElementStyle[]> {
    /* Runs in browser context — DOM globals are available at runtime */
    const extractFn = new Function(`
      const elements = document.querySelectorAll('*');
      const styles = [];
      const properties = [
        'color','backgroundColor','fontSize','fontWeight','fontFamily',
        'lineHeight','letterSpacing','padding','margin','gap','borderRadius',
        'width','height','display','position','flexDirection','alignItems',
        'justifyContent','border','boxShadow','zIndex',
      ];
      // First pass: build selector map for parent lookup
      var selectorMap = new Map();
      elements.forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? '#' + element.id : '';
        const classes = element.className
          ? '.' + element.className.toString().trim().split(/\\s+/).join('.')
          : '';
        var nthChild = 1;
        if (!id && !classes) {
          var sibling = element.previousElementSibling;
          while (sibling) {
            if (sibling.tagName === element.tagName) nthChild++;
            sibling = sibling.previousElementSibling;
          }
        }
        const selector = id || (classes ? tagName + classes : tagName + ':nth-of-type(' + nthChild + ')');
        selectorMap.set(element, selector);
      });
      // Second pass: extract styles with layout context
      elements.forEach((element, index) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const computed = window.getComputedStyle(element);
        const computedStyles = {};
        properties.forEach((prop) => {
          computedStyles[prop] = computed.getPropertyValue(
            prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
          );
        });
        const selector = selectorMap.get(element);
        if (!selector) return;
        const tagName = element.tagName.toLowerCase();
        const penId = element.getAttribute('data-pen-id') || undefined;
        var directText = '';
        for (var ci = 0; ci < element.childNodes.length; ci++) {
          if (element.childNodes[ci].nodeType === 3) {
            directText += element.childNodes[ci].textContent;
          }
        }
        directText = directText.trim();
        // Extract z-index and stacking context
        var zIndex = computed.getPropertyValue('z-index');
        var zIndexNum = zIndex === 'auto' ? undefined : parseInt(zIndex, 10);
        if (zIndexNum !== undefined && isNaN(zIndexNum)) zIndexNum = undefined;
        // Compute stacking layer (simplified: elements with explicit z-index or position != static)
        var pos = computed.getPropertyValue('position');
        var stackingLayer = 0;
        if (pos !== 'static' && zIndexNum !== undefined) {
          stackingLayer = zIndexNum;
        } else if (pos !== 'static') {
          stackingLayer = 1;
        }
        // Layout context
        var display = computed.getPropertyValue('display');
        var flexDir = computed.getPropertyValue('flex-direction');
        var justifyContent = computed.getPropertyValue('justify-content');
        var alignItems = computed.getPropertyValue('align-items');
        var layoutContext = { display: display, position: pos };
        if (display === 'flex' || display === 'inline-flex') {
          layoutContext.flexDirection = flexDir;
          layoutContext.justifyContent = justifyContent;
          layoutContext.alignItems = alignItems;
        }
        // Parent layout context
        var parent = element.parentElement;
        if (parent) {
          var parentSel = selectorMap.get(parent);
          if (parentSel) {
            var parentComputed = window.getComputedStyle(parent);
            var parentDisplay = parentComputed.getPropertyValue('display');
            layoutContext.parentSelector = parentSel;
            if (parentDisplay === 'flex' || parentDisplay === 'inline-flex') {
              layoutContext.parentLayout = {
                display: parentDisplay,
                flexDirection: parentComputed.getPropertyValue('flex-direction'),
                justifyContent: parentComputed.getPropertyValue('justify-content'),
                alignItems: parentComputed.getPropertyValue('align-items'),
              };
            } else {
              layoutContext.parentLayout = { display: parentDisplay };
            }
          }
        }
        styles.push({ selector, tagName, bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, computedStyles, penId: penId, textContent: directText || undefined, zIndex: zIndexNum, stackingLayer: stackingLayer, layoutContext: layoutContext });
      });
      return styles;
    `) as () => DOMElementStyle[];
    return page.evaluate(extractFn);
  }

  /**
   * Extract bounding rectangles for all visible elements.
   */
  async extractElementBounds(page: Page): Promise<ElementBounds[]> {
    /* Runs in browser context — DOM globals are available at runtime */
    const extractFn = new Function(`
      const elements = document.querySelectorAll('*');
      const bounds = [];
      elements.forEach((element, index) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? '#' + element.id : '';
        const classes = element.className
          ? '.' + element.className.toString().trim().split(/\\s+/).join('.')
          : '';
        var nthChild = 1;
        if (!id && !classes) {
          var sibling = element.previousElementSibling;
          while (sibling) {
            if (sibling.tagName === element.tagName) nthChild++;
            sibling = sibling.previousElementSibling;
          }
        }
        const selector = id || (classes ? tagName + classes : tagName + ':nth-of-type(' + nthChild + ')');
        bounds.push({ selector, tagName, bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
      });
      return bounds;
    `) as () => ElementBounds[];
    return page.evaluate(extractFn);
  }

  /**
   * Close the browser and cleanup resources.
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
