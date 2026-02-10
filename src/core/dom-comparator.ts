/**
 * DOM Comparator module for Saccadic AI visual feedback system.
 * Compares DOM computed styles against design state.
 */

import type {
  DOMElementStyle,
  DesignNode,
  DOMDiffResult,
  DOMPropertyMismatch,
  Severity,
  Bounds,
} from './types.js';
import { THRESHOLDS } from './types.js';
import { PixelComparator } from './pixel-comparator.js';

/**
 * Element match result with confidence score.
 */
export interface ElementMatch {
  domElement: DOMElementStyle;
  designNode: DesignNode;
  confidence: number; // IoU score 0-1
}

/** Tags to ignore in comparison (structural/meta elements not in design tools). */
const IGNORED_TAGS = new Set([
  'HTML', 'HEAD', 'BODY', 'META', 'TITLE', 'LINK', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'BR', 'HR',
]);

/**
 * DOMComparator class - compares DOM computed styles against design state.
 */
export class DOMComparator {
  private pixelComparator = new PixelComparator();

  /**
   * Compare DOM computed styles against design nodes.
   */
  compare(domStyles: DOMElementStyle[], designNodes: DesignNode[]): DOMDiffResult {
    // Filter out structural/meta elements that are not meaningful for comparison
    const filteredDomStyles = domStyles.filter(
      (s) => !IGNORED_TAGS.has(s.tagName.toUpperCase())
    );

    // Flatten design node tree for matching (#10)
    const flatNodes = this.flattenDesignNodes(designNodes);
    const matches = this.matchElements(filteredDomStyles, flatNodes);
    const mismatches: DOMPropertyMismatch[] = [];
    const matchedDomSelectors = new Set<string>();
    const matchedDesignIds = new Set<string>();

    // Compare matched elements
    for (const match of matches) {
      const elementMismatches = this.compareProperties(match.domElement, match.designNode);
      mismatches.push(...elementMismatches);
      matchedDomSelectors.add(match.domElement.selector);
      matchedDesignIds.add(match.designNode.id);
    }

    // Find missing elements (in design but not in DOM)
    const missing = flatNodes
      .filter((node) => !matchedDesignIds.has(node.id))
      .map((node) => node.name);

    // Find extra elements (in DOM but not in design)
    const extra = filteredDomStyles
      .filter((style) => !matchedDomSelectors.has(style.selector))
      .map((style) => style.selector);

    return {
      matches: matches.length,
      mismatches,
      missing,
      extra,
    };
  }

  /**
   * Match DOM elements to design nodes by position/bounds overlap.
   * Uses Intersection over Union (IoU) algorithm.
   */
  matchElements(domStyles: DOMElementStyle[], designNodes: DesignNode[]): ElementMatch[] {
    const matches: ElementMatch[] = [];
    const usedDesignNodes = new Set<string>();
    const usedDomSelectors = new Set<string>();

    // Pass 1: Strong IoU matches (> 0.5)
    for (const domElement of domStyles) {
      let bestMatch: ElementMatch | null = null;

      for (const designNode of designNodes) {
        if (usedDesignNodes.has(designNode.id)) continue;

        const iou = this.calculateIoU(domElement.bounds, designNode.bounds);
        if (iou > 0.5 && (!bestMatch || iou > bestMatch.confidence)) {
          bestMatch = { domElement, designNode, confidence: iou };
        }
      }

      if (bestMatch) {
        matches.push(bestMatch);
        usedDesignNodes.add(bestMatch.designNode.id);
        usedDomSelectors.add(bestMatch.domElement.selector);
      }
    }

    // Pass 2: Fallback — match remaining nodes by ID/name/selector similarity + partial IoU
    for (const designNode of designNodes) {
      if (usedDesignNodes.has(designNode.id)) continue;

      let bestMatch: ElementMatch | null = null;
      let bestScore = 0;

      for (const domElement of domStyles) {
        if (usedDomSelectors.has(domElement.selector)) continue;

        const nameScore = this.nameSimilarity(domElement.selector, designNode.id, designNode.name);
        const iou = this.calculateIoU(domElement.bounds, designNode.bounds);
        // Combined score: name similarity weighted heavily, IoU as tiebreaker
        const score = nameScore * 0.7 + Math.min(iou * 2, 1) * 0.3;

        // Require at least some spatial proximity (IoU > 0) to avoid spurious name matches.
        // Exception: exact ID matches (nameScore >= 1.0) are allowed even when IoU = 0,
        // because elements may have reflowed significantly when siblings are missing/extra.
        if (nameScore > 0.3 && (iou > 0 || nameScore >= 1.0) && score > bestScore) {
          bestScore = score;
          bestMatch = { domElement, designNode, confidence: score };
        }
      }

      if (bestMatch) {
        matches.push(bestMatch);
        usedDesignNodes.add(designNode.id);
        usedDomSelectors.add(bestMatch.domElement.selector);
      }
    }

    return matches;
  }

  /**
   * Compute name similarity between a DOM selector and a design node ID/name.
   * Returns 0-1.
   */
  private nameSimilarity(selector: string, nodeId: string, nodeName: string): number {
    const sel = selector.toLowerCase().replace(/[#.]/g, '');
    const id = nodeId.toLowerCase();
    const name = nodeName.toLowerCase().replace(/\s+/g, '-');

    // Exact ID match
    if (sel === id) return 1.0;
    // Selector contains the node ID
    if (sel.includes(id) || id.includes(sel)) return 0.8;
    // Name-based match
    if (sel.includes(name) || name.includes(sel)) return 0.6;
    // Tag-based heuristic: check if tag matches node type
    return 0;
  }

  /**
   * Calculate Intersection over Union (IoU) for two bounding boxes.
   */
  private calculateIoU(bounds1: Bounds, bounds2: Bounds): number {
    const x1 = Math.max(bounds1.x, bounds2.x);
    const y1 = Math.max(bounds1.y, bounds2.y);
    const x2 = Math.min(bounds1.x + bounds1.width, bounds2.x + bounds2.width);
    const y2 = Math.min(bounds1.y + bounds1.height, bounds2.y + bounds2.height);

    // No overlap
    if (x2 < x1 || y2 < y1) return 0;

    const intersection = (x2 - x1) * (y2 - y1);
    const area1 = bounds1.width * bounds1.height;
    const area2 = bounds2.width * bounds2.height;
    const union = area1 + area2 - intersection;

    return union > 0 ? intersection / union : 0;
  }

  /**
   * Compare individual properties between DOM element and design node.
   */
  compareProperties(domStyle: DOMElementStyle, designNode: DesignNode): DOMPropertyMismatch[] {
    const mismatches: DOMPropertyMismatch[] = [];
    const styles = domStyle.computedStyles;

    // Compare colors
    if (designNode.fills && designNode.fills.length > 0) {
      const fill = designNode.fills[0];
      if (fill.type === 'SOLID' && fill.color) {
        const actual = this.parseColor(styles.backgroundColor);
        const expected = fill.color;
        if (actual && !this.colorsMatch(expected, actual)) {
          mismatches.push({
            element: domStyle.selector,
            property: 'backgroundColor',
            expected,
            actual,
            severity: 'fail',
            fix: this.generateFix({
              element: domStyle.selector,
              property: 'backgroundColor',
              expected,
              actual,
              severity: 'fail',
            }),
          });
        }
      }
    }

    // Compare typography
    if (designNode.typography) {
      const typo = designNode.typography;

      // Text color
      if (typo.color) {
        const actual = this.parseColor(styles.color);
        const expected = typo.color;
        if (actual && !this.colorsMatch(expected, actual)) {
          mismatches.push({
            element: domStyle.selector,
            property: 'color',
            expected,
            actual,
            severity: 'fail',
            fix: this.generateFix({
              element: domStyle.selector,
              property: 'color',
              expected,
              actual,
              severity: 'fail',
            }),
          });
        }
      }

      // Font size
      if (typo.fontSize !== undefined) {
        const actual = this.parseNumeric(styles.fontSize);
        const expected = typo.fontSize;
        if (actual !== null && actual !== expected) {
          const severity = this.computeSizeSeverity(expected, actual);
          if (severity !== 'pass') {
            mismatches.push({
              element: domStyle.selector,
              property: 'fontSize',
              expected: `${expected}px`,
              actual: `${actual}px`,
              severity,
              fix: this.generateFix({
                element: domStyle.selector,
                property: 'fontSize',
                expected: `${expected}px`,
                actual: `${actual}px`,
                severity,
              }),
            });
          }
        }
      }

      // Font weight
      if (typo.fontWeight) {
        const actual = this.parseNumeric(styles.fontWeight);
        const expected = typo.fontWeight;
        if (actual && actual !== expected) {
          mismatches.push({
            element: domStyle.selector,
            property: 'fontWeight',
            expected: expected.toString(),
            actual: actual.toString(),
            severity: 'warn',
            fix: this.generateFix({
              element: domStyle.selector,
              property: 'fontWeight',
              expected: expected.toString(),
              actual: actual.toString(),
              severity: 'warn',
            }),
          });
        }
      }

      // Font family
      if (typo.fontFamily) {
        const actual = styles.fontFamily;
        const expected = typo.fontFamily;
        if (actual && !this.fontFamiliesMatch(expected, actual)) {
          mismatches.push({
            element: domStyle.selector,
            property: 'fontFamily',
            expected,
            actual,
            severity: 'warn',
            fix: this.generateFix({
              element: domStyle.selector,
              property: 'fontFamily',
              expected,
              actual,
              severity: 'warn',
            }),
          });
        }
      }

      // Line height
      if (typo.lineHeight) {
        const actual = this.parseNumeric(styles.lineHeight);
        const expected = typo.lineHeight;
        if (actual && actual !== expected) {
          const severity = this.computeSizeSeverity(expected, actual);
          if (severity !== 'pass') {
            mismatches.push({
              element: domStyle.selector,
              property: 'lineHeight',
              expected: `${expected}px`,
              actual: `${actual}px`,
              severity,
              fix: this.generateFix({
                element: domStyle.selector,
                property: 'lineHeight',
                expected: `${expected}px`,
                actual: `${actual}px`,
                severity,
              }),
            });
          }
        }
      }

      // Letter spacing
      if (typo.letterSpacing !== undefined) {
        const actual = this.parseNumeric(styles.letterSpacing);
        const expected = typo.letterSpacing;
        if (actual !== null && actual !== expected) {
          // For letter spacing, treat any difference as a mismatch (use small threshold)
          // Reference value is max of (abs(expected), 1) to avoid division by zero
          const reference = Math.max(Math.abs(expected), 1);
          const weberFraction = Math.abs(expected - actual) / reference;
          let severity: Severity;
          if (weberFraction < THRESHOLDS.size.pass) {
            severity = 'pass';
          } else if (weberFraction < THRESHOLDS.size.warn) {
            severity = 'warn';
          } else {
            severity = 'fail';
          }

          if (severity !== 'pass') {
            mismatches.push({
              element: domStyle.selector,
              property: 'letterSpacing',
              expected: `${expected}px`,
              actual: `${actual}px`,
              severity,
              fix: this.generateFix({
                element: domStyle.selector,
                property: 'letterSpacing',
                expected: `${expected}px`,
                actual: `${actual}px`,
                severity,
              }),
            });
          }
        }
      }
    }

    // Compare spacing - padding
    if (designNode.padding) {
      const padding = designNode.padding;
      const actualPadding = this.parsePadding(styles.padding);
      const sides = ['top', 'right', 'bottom', 'left'] as const;
      const propNames = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const;

      for (let i = 0; i < sides.length; i++) {
        const side = sides[i];
        const expected = padding[side];
        const actual = actualPadding[side];
        if (actual !== expected) {
          const severity = this.computePositionSeverity(expected, actual, expected);
          if (severity !== 'pass') {
            mismatches.push({
              element: domStyle.selector,
              property: propNames[i],
              expected: `${expected}px`,
              actual: `${actual}px`,
              severity,
              fix: this.generateFix({
                element: domStyle.selector,
                property: propNames[i],
                expected: `${expected}px`,
                actual: `${actual}px`,
                severity,
              }),
            });
          }
        }
      }
    }

    // Compare gap
    if (designNode.gap !== undefined) {
      const actual = this.parseNumeric(styles.gap);
      const expected = designNode.gap;
      if (actual !== null && actual !== expected) {
        const severity = this.computePositionSeverity(expected, actual, expected);
        if (severity !== 'pass') {
          mismatches.push({
            element: domStyle.selector,
            property: 'gap',
            expected: `${expected}px`,
            actual: `${actual}px`,
            severity,
            fix: this.generateFix({
              element: domStyle.selector,
              property: 'gap',
              expected: `${expected}px`,
              actual: `${actual}px`,
              severity,
            }),
          });
        }
      }
    }

    // Compare position (x/y offset)
    const actualX = domStyle.bounds.x;
    const actualY = domStyle.bounds.y;
    const expectedX = designNode.bounds.x;
    const expectedY = designNode.bounds.y;

    if (actualX !== expectedX) {
      const severity = this.computePositionSeverity(expectedX, actualX, Math.max(expectedX, designNode.bounds.width));
      if (severity !== 'pass') {
        mismatches.push({
          element: domStyle.selector,
          property: 'x',
          expected: `${expectedX}px`,
          actual: `${actualX}px`,
          severity,
          fix: this.generateFix({
            element: domStyle.selector,
            property: 'left',
            expected: `${expectedX}px`,
            actual: `${actualX}px`,
            severity,
          }),
        });
      }
    }

    if (actualY !== expectedY) {
      const severity = this.computePositionSeverity(expectedY, actualY, Math.max(expectedY, designNode.bounds.height));
      if (severity !== 'pass') {
        mismatches.push({
          element: domStyle.selector,
          property: 'y',
          expected: `${expectedY}px`,
          actual: `${actualY}px`,
          severity,
          fix: this.generateFix({
            element: domStyle.selector,
            property: 'top',
            expected: `${expectedY}px`,
            actual: `${actualY}px`,
            severity,
          }),
        });
      }
    }

    // Compare sizing - width (use bounds for accuracy, CSS width may be 'auto')
    const actualWidth = domStyle.bounds.width;
    const expectedWidth = designNode.bounds.width;
    if (actualWidth !== expectedWidth) {
      const severity = this.computeSizeSeverity(expectedWidth, actualWidth);
      if (severity !== 'pass') {
        mismatches.push({
          element: domStyle.selector,
          property: 'width',
          expected: `${expectedWidth}px`,
          actual: `${actualWidth}px`,
          severity,
          fix: this.generateFix({
            element: domStyle.selector,
            property: 'width',
            expected: `${expectedWidth}px`,
            actual: `${actualWidth}px`,
            severity,
          }),
        });
      }
    }

    // Compare sizing - height (use bounds for accuracy)
    const actualHeight = domStyle.bounds.height;
    const expectedHeight = designNode.bounds.height;
    if (actualHeight !== expectedHeight) {
      const severity = this.computeSizeSeverity(expectedHeight, actualHeight);
      if (severity !== 'pass') {
        mismatches.push({
          element: domStyle.selector,
          property: 'height',
          expected: `${expectedHeight}px`,
          actual: `${actualHeight}px`,
          severity,
          fix: this.generateFix({
            element: domStyle.selector,
            property: 'height',
            expected: `${expectedHeight}px`,
            actual: `${actualHeight}px`,
            severity,
          }),
        });
      }
    }

    // Compare border radius
    if (designNode.cornerRadius !== undefined) {
      const expected = typeof designNode.cornerRadius === 'number'
        ? designNode.cornerRadius
        : designNode.cornerRadius.topLeft; // Use topLeft as representative
      const actual = this.parseNumeric(styles.borderRadius);
      if (actual !== null && actual !== expected) {
        const severity = this.computeSizeSeverity(expected, actual);
        if (severity !== 'pass') {
          mismatches.push({
            element: domStyle.selector,
            property: 'borderRadius',
            expected: `${expected}px`,
            actual: `${actual}px`,
            severity,
            fix: this.generateFix({
              element: domStyle.selector,
              property: 'borderRadius',
              expected: `${expected}px`,
              actual: `${actual}px`,
              severity,
            }),
          });
        }
      }
    }

    return mismatches;
  }

  /**
   * Generate CSS fix suggestion for a property mismatch.
   */
  generateFix(mismatch: DOMPropertyMismatch): string {
    return `Change \`${mismatch.property}: ${mismatch.actual}\` to \`${mismatch.property}: ${mismatch.expected}\` on \`${mismatch.element}\``;
  }

  /**
   * Compute position severity using Weber fraction.
   * Weber fraction = |expected - actual| / reference
   */
  computePositionSeverity(expected: number, actual: number, reference: number): Severity {
    const absReference = Math.abs(reference);

    // For small references (< 100), use 100 as minimum to avoid amplification
    // For normal/large references (>= 100), use actual reference
    const effectiveReference = absReference < 100 ? 100 : absReference;
    const weberFraction = Math.abs(expected - actual) / effectiveReference;

    // For small references, use <= to include boundary as pass
    // For larger references, use < to make boundary cases warn
    if (absReference < 100) {
      if (weberFraction <= THRESHOLDS.position.pass) {
        return 'pass';
      } else if (weberFraction <= THRESHOLDS.position.warn) {
        return 'warn';
      } else {
        return 'fail';
      }
    } else {
      if (weberFraction < THRESHOLDS.position.pass) {
        return 'pass';
      } else if (weberFraction < THRESHOLDS.position.warn) {
        return 'warn';
      } else {
        return 'fail';
      }
    }
  }

  /**
   * Compute size severity using Weber fraction.
   */
  private computeSizeSeverity(expected: number, actual: number): Severity {
    // Guard against divide by zero when expected is 0
    if (expected === 0) {
      return actual === 0 ? 'pass' : 'fail';
    }
    const weberFraction = Math.abs(expected - actual) / Math.abs(expected);

    if (weberFraction < THRESHOLDS.size.pass) {
      return 'pass';
    } else if (weberFraction < THRESHOLDS.size.warn) {
      return 'warn';
    } else {
      return 'fail';
    }
  }

  /**
   * Parse color from CSS value to hex.
   * Supports: hex (#FF0000), rgb(255, 0, 0), rgba(255, 0, 0, 1)
   */
  private parseColor(value: string | undefined): string | null {
    if (!value) return null;

    value = value.trim();

    // Already hex
    if (value.startsWith('#')) {
      return value.toUpperCase();
    }

    // RGB or RGBA
    const rgbMatch = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1], 10);
      const g = parseInt(rgbMatch[2], 10);
      const b = parseInt(rgbMatch[3], 10);
      return `#${this.toHex(r)}${this.toHex(g)}${this.toHex(b)}`;
    }

    return null;
  }

  /**
   * Convert decimal to hex.
   */
  private toHex(n: number): string {
    return n.toString(16).padStart(2, '0').toUpperCase();
  }

  /**
   * Compare two colors for match using CIEDE2000 perceptual distance.
   */
  private colorsMatch(expected: string, actual: string): boolean {
    // Normalize casing for comparison
    const normExpected = expected.toUpperCase();
    const normActual = actual.toUpperCase();
    if (normExpected === normActual) return true;

    // Use perceptual color distance
    const deltaE = this.pixelComparator.computeDeltaE(normExpected, normActual);
    return deltaE < THRESHOLDS.color.pass;
  }

  /**
   * Parse numeric value from CSS (e.g., "16px" -> 16).
   */
  private parseNumeric(value: string | undefined): number | null {
    if (!value) return null;

    // Remove units and parse
    const match = value.match(/^([-\d.]+)/);
    if (match) {
      const num = parseFloat(match[1]);
      return isNaN(num) ? null : num;
    }

    return null;
  }

  /**
   * Parse padding shorthand to individual values.
   * Supports: "8px", "8px 16px", "8px 16px 8px 16px"
   */
  private parsePadding(value: string | undefined): { top: number; right: number; bottom: number; left: number } {
    if (!value) return { top: 0, right: 0, bottom: 0, left: 0 };

    const parts = value.split(/\s+/).map((p) => this.parseNumeric(p) || 0);

    if (parts.length === 1) {
      // All sides
      return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
    } else if (parts.length === 2) {
      // top/bottom, left/right
      return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
    } else if (parts.length === 3) {
      // top, left/right, bottom
      return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
    } else {
      // top, right, bottom, left
      return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
    }
  }

  /**
   * Flatten design node tree into a single array for matching.
   */
  private flattenDesignNodes(nodes: DesignNode[]): DesignNode[] {
    const result: DesignNode[] = [];
    const recurse = (nodeList: DesignNode[]) => {
      for (const node of nodeList) {
        result.push(node);
        if (node.children && node.children.length > 0) {
          recurse(node.children);
        }
      }
    };
    recurse(nodes);
    return result;
  }

  /**
   * Compare font families accounting for fallbacks.
   */
  private fontFamiliesMatch(expected: string, actual: string): boolean {
    // Normalize: remove quotes, lowercase, split on comma
    const normalize = (str: string) =>
      str
        .toLowerCase()
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''));

    const expectedFonts = normalize(expected);
    const actualFonts = normalize(actual);

    // Check if first font matches
    return expectedFonts[0] === actualFonts[0];
  }
}
