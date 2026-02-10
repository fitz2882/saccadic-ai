/**
 * Pencil.dev (.pen) file parser.
 *
 * Parses .pen JSON into Saccadic AI's DesignState for DOM comparison.
 * Five-phase synchronous pipeline:
 *   1. Variable resolution
 *   2. Component registry
 *   3. Ref expansion
 *   4. Layout computation
 *   5. DesignNode conversion
 */

import type { DesignState, DesignNode, DesignTokens, Bounds, Fill, Spacing, Typography, NodeType } from './types.js';
import type { PenFile, PenNode, PenVariable, PenFillObject, PenSize } from './pencil-types.js';

export interface PencilParseOptions {
  frameName?: string;
  themeMode?: string;
}

interface ResolvedPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface ComputedNode extends PenNode {
  absX: number;
  absY: number;
  computedWidth: number;
  computedHeight: number;
  computedChildren?: ComputedNode[];
}

export class PencilParser {
  private variables = new Map<string, string | number>();
  private components = new Map<string, PenNode>();
  private expandingRefs = new Set<string>();

  parse(penData: PenFile, options?: PencilParseOptions): DesignState {
    // Reset state
    this.variables.clear();
    this.components.clear();
    this.expandingRefs.clear();

    // Phase 1: Variable resolution
    this.resolveVariables(penData.variables, options?.themeMode);

    // Phase 2: Component registry
    this.buildComponentRegistry(penData.children);

    // Phase 3: Ref expansion
    const expandedChildren = penData.children.map(c => this.expandRefs(c));

    // Phase 4: Resolve variable references in all node properties
    const resolvedChildren = expandedChildren.map(c => this.resolveNodeVariables(c));

    // Select frame if specified
    let targetNodes = resolvedChildren;
    if (options?.frameName) {
      const frame = resolvedChildren.find(
        n => n.name === options.frameName || n.id === options.frameName
      );
      if (frame) {
        targetNodes = [frame];
      }
    }

    // Phase 4b: Layout computation
    const computedNodes = targetNodes.map(n =>
      this.computeLayout(n, 0, 0, undefined, undefined)
    );

    // Phase 5: DesignNode conversion
    const designNodes = computedNodes.flatMap(n => this.toDesignNodes(n));

    // Extract tokens from variables
    const tokens = this.extractTokens(penData.variables);

    // Compute viewport from top-level frame bounds
    const maxWidth = computedNodes.reduce((m, n) => Math.max(m, n.absX + n.computedWidth), 0);
    const maxHeight = computedNodes.reduce((m, n) => Math.max(m, n.absY + n.computedHeight), 0);

    return {
      id: 'pencil',
      name: options?.frameName || penData.version || 'Pencil Design',
      viewport: {
        width: Math.max(maxWidth, 1280),
        height: Math.max(maxHeight, 800),
      },
      nodes: designNodes,
      tokens,
    };
  }

  // ── Phase 1: Variable Resolution ──

  private resolveVariables(
    variables: PenFile['variables'],
    themeMode?: string
  ): void {
    if (!variables) return;

    for (const [name, variable] of Object.entries(variables)) {
      const value = this.resolveVariableValue(variable, themeMode);
      this.variables.set(name, value);
    }
  }

  private resolveVariableValue(
    variable: PenVariable,
    themeMode?: string
  ): string | number {
    if (Array.isArray(variable.value)) {
      // Themed values — find matching theme or use first
      if (themeMode) {
        const match = variable.value.find(tv =>
          Object.values(tv.theme).some(v => v === themeMode)
        );
        if (match) return match.value;
      }
      return variable.value[0]?.value ?? '';
    }
    return variable.value;
  }

  private resolveTokenRef(value: string | number | undefined): string | number | undefined {
    if (typeof value !== 'string') return value;
    if (!value.startsWith('$--')) return value;
    const varName = value.slice(1); // strip leading $
    return this.variables.get(varName) ?? value;
  }

  // ── Phase 2: Component Registry ──

  private buildComponentRegistry(nodes: PenNode[]): void {
    for (const node of nodes) {
      if (node.reusable) {
        this.components.set(node.id, node);
      }
      if (node.children) {
        this.buildComponentRegistry(node.children);
      }
    }
  }

  // ── Phase 3: Ref Expansion ──

  private expandRefs(node: PenNode): PenNode {
    if (node.type === 'ref' && node.ref) {
      if (this.expandingRefs.has(node.ref)) {
        // Circular ref — return as-is
        return node;
      }

      const prototype = this.components.get(node.ref);
      if (!prototype) return node;

      this.expandingRefs.add(node.ref);

      // Deep clone prototype
      const clone = JSON.parse(JSON.stringify(prototype)) as PenNode;

      // Override with instance properties
      if (node.x !== undefined) clone.x = node.x;
      if (node.y !== undefined) clone.y = node.y;
      if (node.width !== undefined) clone.width = node.width;
      if (node.height !== undefined) clone.height = node.height;
      if (node.fill !== undefined) clone.fill = node.fill;
      if (node.name !== undefined) clone.name = node.name;

      // Apply descendants overrides
      if (node.descendants && clone.children) {
        this.applyDescendants(clone.children, node.descendants);
      }

      // Keep the ref type for mapping
      clone.type = 'ref';
      clone.id = node.id;

      // Recursively expand children
      if (clone.children) {
        clone.children = clone.children.map(c => this.expandRefs(c));
      }

      this.expandingRefs.delete(node.ref);
      return clone;
    }

    // Recursively expand children
    if (node.children) {
      return {
        ...node,
        children: node.children.map(c => this.expandRefs(c)),
      };
    }

    return node;
  }

  private applyDescendants(
    children: PenNode[],
    descendants: Record<string, Partial<PenNode>>
  ): void {
    for (const child of children) {
      const override = descendants[child.id];
      if (override) {
        Object.assign(child, override);
      }
      if (child.children) {
        this.applyDescendants(child.children, descendants);
      }
    }
  }

  // ── Phase 3b: Resolve variable references in node properties ──

  private resolveNodeVariables(node: PenNode): PenNode {
    const resolved = { ...node };

    // Resolve fill
    if (typeof resolved.fill === 'string') {
      resolved.fill = String(this.resolveTokenRef(resolved.fill) ?? resolved.fill);
    }

    // Resolve fontSize
    if (typeof resolved.fontSize === 'string') {
      const ref = this.resolveTokenRef(resolved.fontSize);
      if (typeof ref === 'number') resolved.fontSize = ref;
      else if (typeof ref === 'string' && !isNaN(Number(ref))) resolved.fontSize = Number(ref);
    }

    // Resolve fontFamily
    if (typeof resolved.fontFamily === 'string') {
      resolved.fontFamily = String(this.resolveTokenRef(resolved.fontFamily) ?? resolved.fontFamily);
    }

    // Resolve fontWeight
    if (typeof resolved.fontWeight === 'string') {
      const ref = this.resolveTokenRef(resolved.fontWeight);
      if (typeof ref === 'number') resolved.fontWeight = ref;
      else if (typeof ref === 'string' && !isNaN(Number(ref))) resolved.fontWeight = Number(ref);
    }

    // Resolve cornerRadius
    if (typeof resolved.cornerRadius === 'string') {
      const ref = this.resolveTokenRef(resolved.cornerRadius);
      if (typeof ref === 'number') resolved.cornerRadius = ref;
      else if (typeof ref === 'string' && !isNaN(Number(ref))) resolved.cornerRadius = Number(ref);
    }

    // Recurse children
    if (resolved.children) {
      resolved.children = resolved.children.map(c => this.resolveNodeVariables(c));
    }

    return resolved;
  }

  // ── Phase 4: Layout Computation ──

  private computeLayout(
    node: PenNode,
    parentAbsX: number,
    parentAbsY: number,
    parentContentWidth?: number,
    parentContentHeight?: number
  ): ComputedNode {
    const padding = this.normalizePadding(node.padding);
    const gap = node.gap ?? 0;

    // Resolve own size
    let width = this.resolveSize(node.width, parentContentWidth);
    let height = this.resolveSize(node.height, parentContentHeight);

    // For text nodes, estimate size if not explicit
    if (node.type === 'text') {
      const fontSize = typeof node.fontSize === 'number' ? node.fontSize : 16;
      const lineHeight = node.lineHeight ?? 1.2;
      if (width === 0 && node.content) {
        width = node.content.length * fontSize * 0.55;
      }
      if (height === 0) {
        height = fontSize * lineHeight;
      }
    }

    // Absolute position
    const absX = parentAbsX + (node.x ?? 0);
    const absY = parentAbsY + (node.y ?? 0);

    // Content area (inside padding)
    const contentWidth = Math.max(0, width - padding.left - padding.right);
    const contentHeight = Math.max(0, height - padding.top - padding.bottom);

    // Layout children
    const computedChildren: ComputedNode[] = [];
    const layoutMode = node.layout; // 'vertical' | 'none' | undefined (horizontal)

    if (node.children && node.children.length > 0) {
      let cursor = 0;

      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        let childParentAbsX: number;
        let childParentAbsY: number;

        if (layoutMode === 'none') {
          // Absolute positioning within parent
          childParentAbsX = absX + padding.left;
          childParentAbsY = absY + padding.top;
        } else if (layoutMode === 'vertical') {
          childParentAbsX = absX + padding.left;
          childParentAbsY = absY + padding.top + cursor;
        } else {
          // Default: horizontal
          childParentAbsX = absX + padding.left + cursor;
          childParentAbsY = absY + padding.top;
        }

        const computed = this.computeLayout(
          child,
          childParentAbsX,
          childParentAbsY,
          contentWidth,
          contentHeight
        );
        computedChildren.push(computed);

        if (layoutMode !== 'none') {
          const childExtent = layoutMode === 'vertical'
            ? computed.computedHeight
            : computed.computedWidth;
          cursor += childExtent + (i < node.children.length - 1 ? gap : 0);
        }
      }

      // fit_content: shrink parent to children
      if (this.isFitContent(node.width)) {
        const childrenExtent = layoutMode === 'vertical'
          ? Math.max(0, ...computedChildren.map(c => c.computedWidth))
          : cursor;
        const fitWidth = childrenExtent + padding.left + padding.right;
        const maxFit = this.getFitContentMax(node.width);
        width = maxFit !== undefined ? Math.min(maxFit, fitWidth) : fitWidth;
      }
      if (this.isFitContent(node.height)) {
        const childrenExtent = layoutMode === 'vertical'
          ? cursor
          : Math.max(0, ...computedChildren.map(c => c.computedHeight));
        const fitHeight = childrenExtent + padding.top + padding.bottom;
        const maxFit = this.getFitContentMax(node.height);
        height = maxFit !== undefined ? Math.min(maxFit, fitHeight) : fitHeight;
      }
    }

    return {
      ...node,
      absX,
      absY,
      computedWidth: width,
      computedHeight: height,
      computedChildren,
    };
  }

  private resolveSize(size: PenSize | undefined, parentSize?: number): number {
    if (size === undefined) return 0;
    if (typeof size === 'number') return size;

    if (size === 'fill_container') {
      return parentSize ?? 0;
    }
    const fillMatch = size.match(/^fill_container\((\d+)\)$/);
    if (fillMatch) {
      const maxVal = Number(fillMatch[1]);
      return parentSize !== undefined ? Math.min(maxVal, parentSize) : maxVal;
    }
    // fit_content is resolved after children layout — return 0 as placeholder
    if (size.startsWith('fit_content')) return 0;

    return 0;
  }

  private isFitContent(size: PenSize | undefined): boolean {
    return typeof size === 'string' && size.startsWith('fit_content');
  }

  private getFitContentMax(size: PenSize | undefined): number | undefined {
    if (typeof size !== 'string') return undefined;
    const match = size.match(/^fit_content\((\d+)\)$/);
    return match ? Number(match[1]) : undefined;
  }

  normalizePadding(padding: PenNode['padding']): ResolvedPadding {
    if (padding === undefined) return { top: 0, right: 0, bottom: 0, left: 0 };
    if (typeof padding === 'number') {
      return { top: padding, right: padding, bottom: padding, left: padding };
    }
    if (padding.length === 2) {
      return { top: padding[0], right: padding[1], bottom: padding[0], left: padding[1] };
    }
    return { top: padding[0], right: padding[1], bottom: padding[2], left: padding[3] };
  }

  // ── Phase 5: DesignNode Conversion ──

  private toDesignNodes(node: ComputedNode): DesignNode[] {
    const type = this.mapNodeType(node.type);
    const bounds: Bounds = {
      x: node.absX,
      y: node.absY,
      width: node.computedWidth,
      height: node.computedHeight,
    };

    const fills = this.parseFills(node.fill);
    const padding = this.normalizePadding(node.padding);
    const typography = this.parseTypography(node);

    const children: DesignNode[] = (node.computedChildren ?? []).flatMap(c =>
      this.toDesignNodes(c)
    );

    let layoutMode: 'HORIZONTAL' | 'VERTICAL' | 'NONE' | undefined;
    if (node.layout === 'vertical') layoutMode = 'VERTICAL';
    else if (node.layout === 'none') layoutMode = 'NONE';
    else if (node.children && node.children.length > 0) layoutMode = 'HORIZONTAL';

    const cornerRadius = typeof node.cornerRadius === 'number' ? node.cornerRadius : undefined;

    const designNode: DesignNode = {
      id: node.id,
      name: node.name || node.id,
      type,
      bounds,
      children,
    };

    if (fills && fills.length > 0) designNode.fills = fills;
    if (typography) designNode.typography = typography;
    if (padding.top || padding.right || padding.bottom || padding.left) {
      designNode.padding = padding;
    }
    if (node.gap) designNode.gap = node.gap;
    if (cornerRadius !== undefined) designNode.cornerRadius = cornerRadius;
    if (layoutMode) designNode.layoutMode = layoutMode;

    return [designNode];
  }

  private mapNodeType(penType: PenNode['type']): NodeType {
    switch (penType) {
      case 'frame': return 'FRAME';
      case 'text': return 'TEXT';
      case 'rectangle': return 'RECTANGLE';
      case 'ellipse': return 'ELLIPSE';
      case 'ref': return 'INSTANCE';
      case 'image': return 'IMAGE';
      case 'icon_font':
      case 'path':
      case 'line': return 'VECTOR';
      default: return 'FRAME';
    }
  }

  private parseFills(fill: PenNode['fill']): Fill[] | undefined {
    if (!fill) return undefined;

    if (typeof fill === 'string') {
      if (fill === 'transparent' || fill === '') return undefined;
      return [{ type: 'SOLID', color: fill }];
    }

    const fillObj = fill as PenFillObject;
    if (fillObj.enabled === false) return undefined;
    return [{ type: 'SOLID', color: fillObj.color }];
  }

  private parseTypography(node: ComputedNode): Typography | undefined {
    if (!node.fontFamily && !node.fontSize) return undefined;

    const fontSize = typeof node.fontSize === 'number' ? node.fontSize : 16;
    const lineHeightMultiplier = node.lineHeight ?? 1.2;

    return {
      fontFamily: (typeof node.fontFamily === 'string' ? node.fontFamily : 'Inter'),
      fontSize,
      fontWeight: typeof node.fontWeight === 'number' ? node.fontWeight : 400,
      lineHeight: lineHeightMultiplier * fontSize,
      letterSpacing: node.letterSpacing,
    };
  }

  // ── Token Extraction ──

  private extractTokens(variables?: PenFile['variables']): DesignTokens | undefined {
    if (!variables || Object.keys(variables).length === 0) return undefined;

    const tokens: DesignTokens = {
      colors: {},
      spacing: {},
      typography: {},
      shadows: {},
      borders: {},
      radii: {},
    };

    for (const [name, variable] of Object.entries(variables)) {
      const value = this.variables.get(name);
      if (value === undefined) continue;
      const strValue = String(value);

      if (variable.type === 'color') {
        tokens.colors[name] = strValue;
      } else if (variable.type === 'number') {
        // Classify by name heuristic
        const lower = name.toLowerCase();
        if (lower.includes('radius') || lower.includes('round')) {
          tokens.radii[name] = strValue;
        } else if (lower.includes('spacing') || lower.includes('gap') || lower.includes('padding') || lower.includes('margin')) {
          tokens.spacing[name] = strValue;
        } else {
          tokens.spacing[name] = strValue;
        }
      } else if (variable.type === 'string') {
        const lower = name.toLowerCase();
        if (lower.includes('font')) {
          tokens.typography[name] = {
            fontFamily: strValue,
            fontSize: '',
            fontWeight: '',
            lineHeight: '',
          };
        }
      }
    }

    return tokens;
  }
}
