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
        'justifyContent','border','boxShadow',
      ];
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
        const penId = element.getAttribute('data-pen-id') || undefined;
        var directText = '';
        for (var ci = 0; ci < element.childNodes.length; ci++) {
          if (element.childNodes[ci].nodeType === 3) {
            directText += element.childNodes[ci].textContent;
          }
        }
        directText = directText.trim();
        styles.push({ selector, tagName, bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, computedStyles, penId: penId, textContent: directText || undefined });
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
