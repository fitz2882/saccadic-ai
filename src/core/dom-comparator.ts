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

/** SVG internal elements that are implementation details, not design nodes. */
const SVG_INTERNAL_TAGS = new Set([
  'PATH', 'CIRCLE', 'LINE', 'RECT', 'ELLIPSE', 'POLYGON', 'POLYLINE',
  'G', 'DEFS', 'CLIPPATH', 'MASK', 'USE', 'SYMBOL', 'TSPAN', 'TEXTPATH',
  'LINEARGRADIENT', 'RADIALGRADIENT', 'STOP', 'FILTER',
]);

/**
 * DOMComparator class - compares DOM computed styles against design state.
 */
/**
 * Structural fingerprint for component matching.
 */
interface StructuralFingerprint {
  childCount: number;
  childTypes: string[];
  hasText: boolean;
  hasBg: boolean;
  aspectRatio: number;
  area: number;
}

export class DOMComparator {
  private pixelComparator = new PixelComparator();

  /**
   * Compute normalized Levenshtein similarity between two strings.
   * Returns 0-1 (1 = identical).
   */
  private levenshteinSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (!a.length || !b.length) return 0;

    const matrix: number[][] = [];
    for (let i = 0; i <= a.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= b.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    const distance = matrix[a.length][b.length];
    return 1 - distance / Math.max(a.length, b.length);
  }

  /**
   * Normalize text for fuzzy comparison: lowercase, collapse whitespace,
   * normalize dashes/quotes.
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[\u2018\u2019\u201C\u201D]/g, (c) =>
        c === '\u2018' || c === '\u2019' ? "'" : '"'
      )
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Generate structural fingerprint for a design node.
   */
  private designNodeFingerprint(node: DesignNode): StructuralFingerprint {
    return {
      childCount: node.children?.length || 0,
      childTypes: (node.children || []).map(c => c.type).sort(),
      hasText: node.type === 'TEXT' || (node.children || []).some(c => c.type === 'TEXT'),
      hasBg: !!(node.fills && node.fills.length > 0 && node.fills[0].color),
      aspectRatio: node.bounds.height > 0 ? node.bounds.width / node.bounds.height : 1,
      area: node.bounds.width * node.bounds.height,
    };
  }

  /**
   * Generate structural fingerprint for a DOM element.
   */
  private domElementFingerprint(element: DOMElementStyle, allElements: DOMElementStyle[]): StructuralFingerprint {
    // Find children by containment
    const children = allElements.filter(e =>
      e.selector !== element.selector &&
      this.boundsContain(element.bounds, e.bounds) &&
      // Only direct-ish children (not deeply nested)
      !allElements.some(mid =>
        mid.selector !== element.selector &&
        mid.selector !== e.selector &&
        this.boundsContain(element.bounds, mid.bounds) &&
        this.boundsContain(mid.bounds, e.bounds)
      )
    );

    const textTags = new Set(['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'label']);
    const bgColor = element.computedStyles.backgroundColor;
    const hasVisibleBg = bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent';

    return {
      childCount: children.length,
      childTypes: children.map(c => {
        if (textTags.has(c.tagName.toLowerCase())) return 'TEXT';
        if (c.tagName.toLowerCase() === 'img' || c.tagName.toLowerCase() === 'svg') return 'IMAGE';
        return 'FRAME';
      }).sort(),
      hasText: textTags.has(element.tagName.toLowerCase()) || !!element.textContent,
      hasBg: !!hasVisibleBg,
      aspectRatio: element.bounds.height > 0 ? element.bounds.width / element.bounds.height : 1,
      area: element.bounds.width * element.bounds.height,
    };
  }

  /**
   * Compare two structural fingerprints. Returns 0-1 similarity.
   */
  private fingerprintSimilarity(a: StructuralFingerprint, b: StructuralFingerprint): number {
    let score = 0;

    // Child count similarity (30%)
    const maxChildren = Math.max(a.childCount, b.childCount, 1);
    score += 0.3 * (1 - Math.abs(a.childCount - b.childCount) / maxChildren);

    // Child type overlap (25%)
    const typeOverlap = this.arrayOverlap(a.childTypes, b.childTypes);
    score += 0.25 * typeOverlap;

    // Text presence (15%)
    score += 0.15 * (a.hasText === b.hasText ? 1 : 0);

    // Background presence (10%)
    score += 0.1 * (a.hasBg === b.hasBg ? 1 : 0);

    // Aspect ratio similarity (20%)
    const maxAR = Math.max(a.aspectRatio, b.aspectRatio, 0.1);
    const minAR = Math.min(a.aspectRatio, b.aspectRatio, 0.1);
    score += 0.2 * (minAR / maxAR);

    return score;
  }

  /**
   * Compute overlap ratio between two sorted string arrays.
   */
  private arrayOverlap(a: string[], b: string[]): number {
    if (a.length === 0 && b.length === 0) return 1;
    if (a.length === 0 || b.length === 0) return 0;
    const setA = new Set(a);
    const intersection = b.filter(x => setA.has(x)).length;
    return intersection / Math.max(a.length, b.length);
  }

  /**
   * Check if bounds A fully contains bounds B.
   */
  private boundsContain(a: Bounds, b: Bounds): boolean {
    return (
      a.x <= b.x &&
      a.y <= b.y &&
      a.x + a.width >= b.x + b.width &&
      a.y + a.height >= b.y + b.height
    );
  }

  /**
   * Compare DOM computed styles against design nodes.
   */
  compare(domStyles: DOMElementStyle[], designNodes: DesignNode[]): DOMDiffResult {
    // Filter out structural/meta elements and SVG internals
    const filteredDomStyles = domStyles.filter(
      (s) => !IGNORED_TAGS.has(s.tagName.toUpperCase()) && !SVG_INTERNAL_TAGS.has(s.tagName.toUpperCase())
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

    // Partition DOM elements by stacking layer for z-index awareness (t-005)
    const layerMap = new Map<number, DOMElementStyle[]>();
    for (const el of domStyles) {
      const layer = el.stackingLayer ?? 0;
      if (!layerMap.has(layer)) layerMap.set(layer, []);
      layerMap.get(layer)!.push(el);
    }

    // Pass 0: Exact penId match (data-pen-id attribute to designNode.id or .name)
    for (const domElement of domStyles) {
      if (!domElement.penId) continue;

      for (const designNode of designNodes) {
        if (usedDesignNodes.has(designNode.id)) continue;
        if (domElement.penId === designNode.id || domElement.penId === designNode.name) {
          matches.push({ domElement, designNode, confidence: 1.0 });
          usedDesignNodes.add(designNode.id);
          usedDomSelectors.add(domElement.selector);
          break;
        }
      }
    }

    // Pass 0.5: Structural fingerprinting — match components by structure (t-004)
    for (const designNode of designNodes) {
      if (usedDesignNodes.has(designNode.id)) continue;
      // Only fingerprint non-leaf nodes (components/frames with children)
      if (!designNode.children || designNode.children.length === 0) continue;

      const designFP = this.designNodeFingerprint(designNode);
      let bestMatch: ElementMatch | null = null;
      let bestScore = 0;

      for (const domElement of domStyles) {
        if (usedDomSelectors.has(domElement.selector)) continue;

        const domFP = this.domElementFingerprint(domElement, domStyles);
        const fpScore = this.fingerprintSimilarity(designFP, domFP);

        // Also require some spatial proximity
        const iou = this.calculateIoU(domElement.bounds, designNode.bounds);
        const combined = fpScore * 0.6 + Math.min(iou * 2, 1) * 0.4;

        if (combined > 0.55 && combined > bestScore) {
          bestScore = combined;
          bestMatch = { domElement, designNode, confidence: combined };
        }
      }

      if (bestMatch) {
        matches.push(bestMatch);
        usedDesignNodes.add(designNode.id);
        usedDomSelectors.add(bestMatch.domElement.selector);
      }
    }

    // Pass 1: Strong IoU matches (> 0.5) — within same stacking layer (t-005)
    for (const domElement of domStyles) {
      if (usedDomSelectors.has(domElement.selector)) continue;
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

    // Pass 2: Text content matching with fuzzy support (t-002)
    for (const designNode of designNodes) {
      if (usedDesignNodes.has(designNode.id)) continue;
      if (designNode.type !== 'TEXT' || !designNode.textContent) continue;

      let bestMatch: ElementMatch | null = null;
      let bestIoU = -1;

      for (const domElement of domStyles) {
        if (usedDomSelectors.has(domElement.selector)) continue;
        if (!domElement.textContent) continue;

        const designText = this.normalizeText(designNode.textContent);
        const domText = this.normalizeText(domElement.textContent);
        if (!designText || !domText) continue;

        // Exact or substring match (original behavior)
        let isMatch = designText === domText ||
          domText.includes(designText) ||
          designText.includes(domText);

        // Fuzzy match via Levenshtein if no exact match (t-002)
        if (!isMatch) {
          const similarity = this.levenshteinSimilarity(designText, domText);
          isMatch = similarity >= 0.8;
        }

        if (isMatch) {
          const iou = this.calculateIoU(domElement.bounds, designNode.bounds);
          if (iou > bestIoU) {
            bestIoU = iou;
            bestMatch = { domElement, designNode, confidence: 0.85 };
          }
        }
      }

      if (bestMatch) {
        matches.push(bestMatch);
        usedDesignNodes.add(designNode.id);
        usedDomSelectors.add(bestMatch.domElement.selector);
      }
    }

    // Pass 3: Type + visual similarity scoring
    for (const designNode of designNodes) {
      if (usedDesignNodes.has(designNode.id)) continue;

      let bestMatch: ElementMatch | null = null;
      let bestScore = 0;

      for (const domElement of domStyles) {
        if (usedDomSelectors.has(domElement.selector)) continue;

        const iou = this.calculateIoU(domElement.bounds, designNode.bounds);
        // Require at least some spatial proximity
        if (iou === 0) continue;

        const typeScore = this.typeCompatibility(designNode.type, domElement.tagName) || 0;
        const colorScore = this.colorSimilarity(designNode, domElement) || 0;
        const sizeScore = this.sizeSimilarity(designNode.bounds, domElement.bounds) || 0;

        const score = typeScore * 0.3 + colorScore * 0.25 + sizeScore * 0.25 + Math.min(iou * 2, 1) * 0.2;

        if (!isNaN(score) && score > 0.4 && score > bestScore) {
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

    // Pass 4: Fallback — match remaining nodes by ID/name/selector similarity + partial IoU
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

    // Compare colors — skip fills→backgroundColor for TEXT nodes since their
    // fill is the foreground text color, compared via typography.color below
    if (designNode.fills && designNode.fills.length > 0 && designNode.type !== 'TEXT') {
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

    // Compare position (x/y offset) — with layout-aware tolerance (t-003)
    const actualX = domStyle.bounds.x;
    const actualY = domStyle.bounds.y;
    const expectedX = designNode.bounds.x;
    const expectedY = designNode.bounds.y;

    // Layout-aware: if parent is a flex container with space-between/space-evenly/space-around,
    // position mismatches on the distribution axis are expected due to flex distribution
    const suppressFlexPosition = this.shouldSuppressFlexPosition(domStyle);
    const flexAxis = this.getFlexDistributionAxis(domStyle);

    if (actualX !== expectedX && !(suppressFlexPosition && flexAxis === 'horizontal')) {
      const severity = this.computePositionSeverity(expectedX, actualX, Math.max(expectedX, designNode.bounds.width));
      if (severity !== 'pass') {
        mismatches.push({
          element: domStyle.selector,
          property: 'x',
          expected: `${expectedX}px`,
          actual: `${actualX}px`,
          severity,
          fix: this.generateFixWithContext({
            element: domStyle.selector,
            property: 'left',
            expected: `${expectedX}px`,
            actual: `${actualX}px`,
            severity,
          }, domStyle),
        });
      }
    }

    if (actualY !== expectedY && !(suppressFlexPosition && flexAxis === 'vertical')) {
      const severity = this.computePositionSeverity(expectedY, actualY, Math.max(expectedY, designNode.bounds.height));
      if (severity !== 'pass') {
        mismatches.push({
          element: domStyle.selector,
          property: 'y',
          expected: `${expectedY}px`,
          actual: `${actualY}px`,
          severity,
          fix: this.generateFixWithContext({
            element: domStyle.selector,
            property: 'top',
            expected: `${expectedY}px`,
            actual: `${actualY}px`,
            severity,
          }, domStyle),
        });
      }
    }

    // Compare sizing - width (use bounds for accuracy, CSS width may be 'auto')
    // Skip when expectedWidth is 0 — indicates fit_content/auto sizing from the parser
    const actualWidth = domStyle.bounds.width;
    const expectedWidth = designNode.bounds.width;
    if (expectedWidth > 0 && actualWidth !== expectedWidth) {
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
    // Skip when expectedHeight is 0 — indicates fit_content/auto sizing from the parser
    const actualHeight = domStyle.bounds.height;
    const expectedHeight = designNode.bounds.height;
    if (expectedHeight > 0 && actualHeight !== expectedHeight) {
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
   * Generate CSS fix with layout and specificity context (t-011).
   */
  private generateFixWithContext(mismatch: DOMPropertyMismatch, domStyle: DOMElementStyle): string {
    let fix = `Change \`${mismatch.property}: ${mismatch.actual}\` to \`${mismatch.property}: ${mismatch.expected}\` on \`${mismatch.element}\``;

    // Add specificity hint based on selector type
    const selector = domStyle.selector;
    if (selector.startsWith('#')) {
      fix += ` (ID selector — high specificity, prefer class override)`;
    } else if (selector.includes('.')) {
      fix += ` (class selector — use the class rule)`;
    } else {
      fix += ` (element selector — add a class for targeted styling)`;
    }

    // Add layout context hint
    if (domStyle.layoutContext?.parentLayout?.display === 'flex') {
      const dir = domStyle.layoutContext.parentLayout.flexDirection || 'row';
      if (mismatch.property === 'left' || mismatch.property === 'top') {
        fix += `. Parent is flex (${dir}) — consider adjusting parent's justify-content/align-items or this element's margin/order`;
      }
    }

    return fix;
  }

  /**
   * Check if position mismatches should be suppressed due to flex distribution (t-003).
   */
  private shouldSuppressFlexPosition(domStyle: DOMElementStyle): boolean {
    const parentLayout = domStyle.layoutContext?.parentLayout;
    if (!parentLayout) return false;
    if (parentLayout.display !== 'flex' && parentLayout.display !== 'inline-flex') return false;

    const jc = parentLayout.justifyContent;
    // These justify-content values distribute children with varying gaps,
    // so individual child positions will differ from design even when layout intent is correct
    return jc === 'space-between' || jc === 'space-evenly' || jc === 'space-around';
  }

  /**
   * Get the axis along which flex distribution occurs (t-003).
   */
  private getFlexDistributionAxis(domStyle: DOMElementStyle): 'horizontal' | 'vertical' | null {
    const parentLayout = domStyle.layoutContext?.parentLayout;
    if (!parentLayout || (parentLayout.display !== 'flex' && parentLayout.display !== 'inline-flex')) return null;
    const dir = parentLayout.flexDirection || 'row';
    return dir === 'column' || dir === 'column-reverse' ? 'vertical' : 'horizontal';
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
    // When expected is 0, it means auto/fit-content — don't penalize the build
    if (expected === 0) {
      return 'pass';
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

    // RGB or RGBA (handles decimal values like rgb(59.5, 130.2, 246.8))
    const rgbMatch = value.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*[\d.]+)?\)/);
    if (rgbMatch) {
      const r = Math.round(parseFloat(rgbMatch[1]));
      const g = Math.round(parseFloat(rgbMatch[2]));
      const b = Math.round(parseFloat(rgbMatch[3]));
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
   * Check type compatibility between a design node type and a DOM tag.
   * Returns 0-1 score.
   */
  private typeCompatibility(designType: string, tagName: string): number {
    const tag = tagName.toLowerCase();
    const textTags = new Set(['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'label', 'li', 'td', 'th', 'strong', 'em', 'b', 'i', 'small']);
    const frameTags = new Set(['div', 'section', 'nav', 'header', 'footer', 'main', 'aside', 'article', 'ul', 'ol', 'table', 'form']);
    const inputTags = new Set(['input', 'textarea', 'select', 'button']);
    const imageTags = new Set(['img', 'svg', 'picture', 'canvas', 'video']);

    switch (designType) {
      case 'TEXT': return textTags.has(tag) ? 1.0 : 0;
      case 'FRAME':
      case 'GROUP':
      case 'COMPONENT':
      case 'INSTANCE': return frameTags.has(tag) ? 1.0 : 0.3;
      case 'INPUT':
      case 'BUTTON': return inputTags.has(tag) ? 1.0 : 0;
      case 'VECTOR': {
        const vectorTags = new Set(['svg', 'path', 'circle', 'line', 'polygon', 'polyline', 'rect', 'ellipse', 'i', 'span']);
        return vectorTags.has(tag) ? 1.0 : 0;
      }
      case 'IMAGE': return (imageTags.has(tag) && tag !== 'svg') ? 1.0 : 0;
      case 'RECTANGLE': return frameTags.has(tag) ? 0.5 : 0.2;
      default: return 0.2;
    }
  }

  /**
   * Compare colors between a design node and a DOM element.
   * Returns 0-1 similarity score.
   */
  private colorSimilarity(designNode: DesignNode, domElement: DOMElementStyle): number {
    // Get design color (fill or text color)
    let designColor: string | undefined;
    if (designNode.fills?.[0]?.color) {
      designColor = designNode.fills[0].color;
    } else if (designNode.typography?.color) {
      designColor = designNode.typography.color;
    }
    if (!designColor) return 0.5; // neutral when no design color

    // Get DOM color
    const domBgColor = this.parseColor(domElement.computedStyles.backgroundColor);
    const domTextColor = this.parseColor(domElement.computedStyles.color);

    let bestSimilarity = 0;
    if (domBgColor) {
      const deltaE = this.pixelComparator.computeDeltaE(designColor.toUpperCase(), domBgColor.toUpperCase());
      bestSimilarity = Math.max(bestSimilarity, Math.max(0, 1 - deltaE / 50));
    }
    if (domTextColor) {
      const deltaE = this.pixelComparator.computeDeltaE(designColor.toUpperCase(), domTextColor.toUpperCase());
      bestSimilarity = Math.max(bestSimilarity, Math.max(0, 1 - deltaE / 50));
    }

    return bestSimilarity;
  }

  /**
   * Compare sizes between design bounds and DOM bounds.
   * Returns 0-1 similarity score.
   */
  private sizeSimilarity(designBounds: Bounds, domBounds: Bounds): number {
    if (designBounds.width === 0 || designBounds.height === 0) return 0;

    const widthRatio = Math.min(designBounds.width, domBounds.width) / Math.max(designBounds.width, domBounds.width);
    const heightRatio = Math.min(designBounds.height, domBounds.height) / Math.max(designBounds.height, domBounds.height);

    return (widthRatio + heightRatio) / 2;
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
