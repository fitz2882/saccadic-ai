/**
 * Feedback Generator
 *
 * Transforms comparison results into actionable feedback items.
 * Maps pixel regions to DOM elements, generates human-readable summaries,
 * and creates visual diff overlays.
 */

import type {
  DOMDiffResult,
  PixelDiffResult,
  DiffRegion,
  FeedbackItem,
  DOMElementStyle,
  ComparisonResult,
  Bounds,
  Severity,
  DOMPropertyMismatch,
} from './types.js';

export class FeedbackGenerator {
  /**
   * Transform comparison results into ordered feedback items.
   *
   * Priority: fail items first, then warn, then pass.
   */
  generate(
    domDiff: DOMDiffResult,
    pixelDiff: PixelDiffResult,
    regions: DiffRegion[],
    domStyles?: DOMElementStyle[]
  ): FeedbackItem[] {
    const feedback: FeedbackItem[] = [];

    // 1. DOM mismatches
    for (const mismatch of domDiff.mismatches) {
      feedback.push({
        severity: mismatch.severity,
        category: this.categorizeProperty(mismatch.property),
        message: `${mismatch.element}: ${mismatch.property} mismatch. Expected "${mismatch.expected}", got "${mismatch.actual}".`,
        element: mismatch.element,
        fix: mismatch.fix,
      });
    }

    // 2. Missing elements
    for (const selector of domDiff.missing) {
      feedback.push({
        severity: 'fail',
        category: 'missing',
        message: `Missing element: ${selector}`,
        element: selector,
      });
    }

    // 3. Extra elements
    for (const selector of domDiff.extra) {
      feedback.push({
        severity: 'warn',
        category: 'extra',
        message: `Extra element found: ${selector}`,
        element: selector,
      });
    }

    // 4. Pixel diff regions (deduplicate against DOM feedback)
    const hasDomFeedback = feedback.length > 0;
    const domReportedElements = new Set(
      feedback.map((f) => f.element).filter(Boolean)
    );

    for (const region of regions) {
      const element = domStyles
        ? this.mapRegionToElement(region, domStyles)
        : undefined;

      // Skip pixel region if its element already has DOM-level feedback
      if (element && domReportedElements.has(element)) {
        continue;
      }

      // When DOM comparison found issues, only include fail-severity pixel items
      // to reduce noise from minor pixel differences already covered by DOM analysis
      if (hasDomFeedback && region.severity !== 'fail') {
        continue;
      }

      const categoryMap: Record<string, FeedbackItem['category']> = {
        color: 'color',
        position: 'layout',
        size: 'size',
        missing: 'missing',
        extra: 'extra',
        typography: 'typography',
        rendering: 'rendering',
      };
      feedback.push({
        severity: region.severity,
        category: categoryMap[region.type] || 'rendering',
        message: region.description,
        element,
      });
    }

    // 5. Cascade suppression: suppress position/size FPs caused by missing/extra elements
    const suppressed = this.suppressCascadeEffects(feedback, domDiff, domStyles);

    // Sort by severity: fail > warn > pass
    const severityOrder: Record<Severity, number> = {
      fail: 0,
      warn: 1,
      pass: 2,
    };

    suppressed.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return suppressed;
  }

  /**
   * Suppress cascading false positives caused by root-cause mismatches.
   *
   * Cascade rules:
   * 1. Same-element: height suppressed when lineHeight/fontSize/padding also mismatched
   * 2. Parent-child: child position/size suppressed when parent has padding/size mismatch
   * 3. Missing/extra reflow: height on parents, position on siblings
   */
  suppressCascadeEffects(
    feedback: FeedbackItem[],
    domDiff: DOMDiffResult,
    domStyles?: DOMElementStyle[]
  ): FeedbackItem[] {
    // Build per-element mismatch property sets from DOM comparator
    const mismatchProps = new Map<string, Set<string>>();
    for (const m of domDiff.mismatches) {
      if (!mismatchProps.has(m.element)) mismatchProps.set(m.element, new Set());
      mismatchProps.get(m.element)!.add(m.property);
    }

    // Build element bounds map for parent-child inference
    const boundsMap = new Map<string, Bounds>();
    if (domStyles) {
      for (const s of domStyles) boundsMap.set(s.selector, s.bounds);
    }

    const hasMissingOrExtra = domDiff.missing.length > 0 || domDiff.extra.length > 0;

    return feedback.filter((item) => {
      if (!item.element) return true;
      // Always keep root cause items (missing/extra/color/typography)
      if (item.category === 'missing' || item.category === 'extra') return true;
      if (item.category === 'color' || item.category === 'typography') return true;

      const msg = item.message || '';
      const props = mismatchProps.get(item.element);

      // Classify the feedback type
      const isHeight = item.category === 'size' && msg.includes('height');
      const isWidth = item.category === 'size' && msg.includes('width');
      const isXPos = item.category === 'layout' && msg.includes('x mismatch');
      const isYPos = item.category === 'layout' && msg.includes('y mismatch');

      // Rule 1: Suppress size when explained by other properties on same element
      if (isHeight && props) {
        if (props.has('lineHeight') || props.has('fontSize') ||
            props.has('paddingTop') || props.has('paddingBottom')) {
          return false;
        }
      }
      if (isWidth && props) {
        if (props.has('paddingLeft') || props.has('paddingRight') || props.has('gap')) {
          return false;
        }
      }

      // Rule 2: Suppress child position/size when parent has relevant padding/size mismatch
      if (isXPos && this.hasAncestorCascade(item.element, 'x', mismatchProps, boundsMap)) return false;
      if (isYPos && this.hasAncestorCascade(item.element, 'y', mismatchProps, boundsMap)) return false;
      if (isWidth && this.hasAncestorCascade(item.element, 'width', mismatchProps, boundsMap)) return false;
      if (isHeight && this.hasAncestorCascade(item.element, 'height', mismatchProps, boundsMap)) return false;

      // Rule 3: Missing/extra reflow — suppress layout/size/spacing cascade effects
      if (hasMissingOrExtra) {
        const cascadeCategories = new Set<FeedbackItem['category']>(['layout', 'size', 'spacing']);
        if (cascadeCategories.has(item.category)) {
          // Suppress all layout/size/spacing when missing/extra exists,
          // UNLESS the element itself has a root-cause mismatch (padding, gap, explicit size)
          if (!this.isRootCauseSizeItem(item, props)) {
            return false;
          }
          // Suppress height on containers whose height changed due to missing/extra children.
          // Only suppress when the element has FEW other mismatches (suggesting content-derived height,
          // not explicitly styled height). Elements with many mismatches likely have explicit height.
          if (isHeight && this.isContainer(item.element, boundsMap)) {
            const otherProps = props ? new Set([...props].filter(p => p !== 'height')) : new Set<string>();
            const hasExplicitStyling = otherProps.size >= 2;
            if (!hasExplicitStyling) {
              return false;
            }
          }
        }
      }

      return true;
    });
  }

  /**
   * Check if an item represents a root-cause size/spacing mismatch
   * (not a cascade from other changes).
   */
  private isRootCauseSizeItem(
    item: FeedbackItem,
    elementProps?: Set<string>
  ): boolean {
    const msg = item.message || '';

    // Padding mismatches are root causes
    if (item.category === 'spacing') return true;

    // Width/height on elements that DON'T have other mismatches explaining the size
    // are root causes (e.g., explicitly different CSS width/height)
    if (item.category === 'size') {
      const isHeight = msg.includes('height');
      const isWidth = msg.includes('width');
      if (isHeight && elementProps) {
        // Height explained by padding/lineHeight/fontSize → not root cause
        if (elementProps.has('paddingTop') || elementProps.has('paddingBottom') ||
            elementProps.has('lineHeight') || elementProps.has('fontSize')) {
          return false;
        }
      }
      // Width with no other explanatory mismatches on same element → could be root cause
      if (isWidth && elementProps) {
        if (elementProps.has('paddingLeft') || elementProps.has('paddingRight') ||
            elementProps.has('gap')) {
          return false;
        }
      }
      return true;
    }

    return false;
  }

  /**
   * Check if any ancestor has mismatches that explain a child's position/size cascade.
   * Returns true if the specific property type is explained by ancestor changes.
   */
  private hasAncestorCascade(
    element: string,
    propertyType: 'x' | 'y' | 'width' | 'height',
    mismatchProps: Map<string, Set<string>>,
    boundsMap: Map<string, Bounds>
  ): boolean {
    const childBounds = boundsMap.get(element);
    if (!childBounds) return false;

    for (const [el, props] of mismatchProps) {
      if (el === element) continue;
      const parentBounds = boundsMap.get(el);
      if (!parentBounds) continue;
      if (!this.boundsContain(parentBounds, childBounds)) continue;

      // Map: which ancestor properties explain which child cascades
      // In normal document flow, height cascades UPWARD (child → parent),
      // not downward. Only suppress x/y/width based on ancestor changes.
      switch (propertyType) {
        case 'x':
          if (props.has('paddingLeft') || props.has('paddingRight') || props.has('width')) return true;
          break;
        case 'y':
          if (props.has('paddingTop') || props.has('paddingBottom') || props.has('height')) return true;
          break;
        case 'width':
          if (props.has('paddingLeft') || props.has('paddingRight') || props.has('width')) return true;
          break;
        case 'height':
          // Height rarely cascades from ancestor in normal flow
          break;
      }
    }

    return false;
  }

  /**
   * Check if an element is a container (has other elements inside it).
   */
  private isContainer(element: string, boundsMap: Map<string, Bounds>): boolean {
    const elBounds = boundsMap.get(element);
    if (!elBounds) return false;

    for (const [sel, bounds] of boundsMap) {
      if (sel === element) continue;
      if (this.boundsContain(elBounds, bounds)) return true;
    }
    return false;
  }

  /**
   * Check if two bounds overlap at all.
   */
  private boundsOverlap(a: Bounds, b: Bounds): boolean {
    return !(
      a.x + a.width < b.x ||
      b.x + b.width < a.x ||
      a.y + a.height < b.y ||
      b.y + b.height < a.y
    );
  }

  /**
   * Generate human-readable summary of comparison result.
   *
   * Example: "Match: 87% (Grade B). 3 issues found: 1 color mismatch, 1 spacing error, 1 missing element."
   */
  generateSummary(result: ComparisonResult): string {
    const { overall, feedback } = result;
    const percentage = Math.round(overall.matchPercentage * 100);

    // Count issues by category
    const failCount = feedback.filter((f) => f.severity === 'fail').length;
    const warnCount = feedback.filter((f) => f.severity === 'warn').length;

    // Categorize issues
    const categoryCounts = new Map<string, number>();
    for (const item of feedback) {
      if (item.severity === 'fail' || item.severity === 'warn') {
        const count = categoryCounts.get(item.category) || 0;
        categoryCounts.set(item.category, count + 1);
      }
    }

    // Build summary
    let summary = `Match: ${percentage}% (Grade ${overall.grade}).`;

    if (failCount === 0 && warnCount === 0) {
      summary += ' Perfect match!';
    } else {
      const totalIssues = failCount + warnCount;
      summary += ` ${totalIssues} issue${totalIssues === 1 ? '' : 's'} found`;

      // List top 3 categories
      const topCategories = Array.from(categoryCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

      if (topCategories.length > 0) {
        const categoryList = topCategories
          .map(([cat, count]) => `${count} ${cat} ${count === 1 ? 'issue' : 'issues'}`)
          .join(', ');
        summary += `: ${categoryList}`;
      }

      summary += '.';
    }

    return summary;
  }



  /**
   * Map pixel diff region to DOM element via bounding box intersection.
   *
   * Finds the smallest DOM element that fully contains the region.
   */
  mapRegionToElement(
    region: DiffRegion,
    domStyles: DOMElementStyle[]
  ): string | undefined {
    let bestMatch: DOMElementStyle | undefined;
    let smallestArea = Infinity;

    for (const element of domStyles) {
      if (this.boundsContain(element.bounds, region.bounds)) {
        const area = element.bounds.width * element.bounds.height;
        if (area < smallestArea) {
          smallestArea = area;
          bestMatch = element;
        }
      }
    }

    return bestMatch?.selector;
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
   * Categorize CSS property into feedback category.
   */
  private categorizeProperty(property: string): FeedbackItem['category'] {
    // Support both camelCase (from DOM comparator) and kebab-case
    const normalize = (s: string) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    const prop = normalize(property);

    const colorProps = [
      'color',
      'background-color',
      'border-color',
      'fill',
      'stroke',
    ];
    const spacingProps = [
      'margin',
      'padding',
      'gap',
      'margin-top',
      'margin-right',
      'margin-bottom',
      'margin-left',
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
    ];
    const typographyProps = [
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'letter-spacing',
      'text-align',
    ];
    const sizeProps = ['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height'];
    const layoutProps = [
      'display',
      'position',
      'top',
      'right',
      'bottom',
      'left',
      'x',
      'y',
      'flex',
      'grid',
      'align-items',
      'justify-content',
    ];

    if (colorProps.includes(prop)) {
      return 'color';
    } else if (spacingProps.includes(prop)) {
      return 'spacing';
    } else if (typographyProps.includes(prop)) {
      return 'typography';
    } else if (sizeProps.includes(prop)) {
      return 'size';
    } else if (layoutProps.includes(prop)) {
      return 'layout';
    } else {
      return 'rendering';
    }
  }
}
