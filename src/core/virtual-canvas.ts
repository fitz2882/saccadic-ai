/**
 * Virtual Canvas - Spatial indexing for UI elements using rbush R-tree.
 *
 * Provides O(log n) spatial queries for element lookup, overlap detection,
 * alignment analysis, and spacing consistency checks.
 */

import RBush from 'rbush';
import type {
  UINode,
  AlignmentReport,
  AlignmentGroup,
  SpacingIssue,
  Bounds,
  DOMElementStyle,
  DesignNode,
  Viewport,
} from './types.js';

interface RBushItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  node: UINode;
}

export class VirtualCanvas {
  private tree: RBush<RBushItem>;
  private nodes: Map<string, UINode> = new Map();
  readonly viewport: Viewport;

  constructor(viewport: Viewport) {
    this.tree = new RBush<RBushItem>();
    this.viewport = viewport;
  }

  static fromDOMStyles(styles: DOMElementStyle[], viewport: Viewport): VirtualCanvas {
    const canvas = new VirtualCanvas(viewport);
    for (const style of styles) {
      const node: UINode = {
        id: style.selector,
        name: style.selector,
        bounds: style.bounds,
        type: style.tagName,
        style: style.computedStyles,
      };
      canvas.insert(node);
    }
    return canvas;
  }

  static fromDesignNodes(nodes: DesignNode[], viewport: Viewport): VirtualCanvas {
    const canvas = new VirtualCanvas(viewport);
    const flatten = (designNodes: DesignNode[], parentId?: string) => {
      for (const dn of designNodes) {
        const node: UINode = {
          id: dn.id,
          name: dn.name,
          bounds: dn.bounds,
          type: dn.type,
          parentId,
          children: dn.children?.map((c) => c.id),
        };
        canvas.insert(node);
        if (dn.children?.length) {
          flatten(dn.children, dn.id);
        }
      }
    };
    flatten(nodes);
    return canvas;
  }

  insert(node: UINode): void {
    this.nodes.set(node.id, node);
    this.tree.insert({
      minX: node.bounds.x,
      minY: node.bounds.y,
      maxX: node.bounds.x + node.bounds.width,
      maxY: node.bounds.y + node.bounds.height,
      node,
    });
  }

  findAt(x: number, y: number): UINode[] {
    return this.tree
      .search({ minX: x, minY: y, maxX: x, maxY: y })
      .map((item) => item.node);
  }

  findOverlapping(bounds: Bounds): UINode[] {
    return this.tree
      .search({
        minX: bounds.x,
        minY: bounds.y,
        maxX: bounds.x + bounds.width,
        maxY: bounds.y + bounds.height,
      })
      .map((item) => item.node);
  }

  findInRegion(bounds: Bounds): UINode[] {
    return this.findOverlapping(bounds).filter((node) => {
      return (
        node.bounds.x >= bounds.x &&
        node.bounds.y >= bounds.y &&
        node.bounds.x + node.bounds.width <= bounds.x + bounds.width &&
        node.bounds.y + node.bounds.height <= bounds.y + bounds.height
      );
    });
  }

  getNode(id: string): UINode | undefined {
    return this.nodes.get(id);
  }

  getAllNodes(): UINode[] {
    return Array.from(this.nodes.values());
  }

  getParent(node: UINode): UINode | undefined {
    if (!node.parentId) return undefined;
    return this.nodes.get(node.parentId);
  }

  getSiblings(node: UINode): UINode[] {
    if (!node.parentId) return [];
    const parent = this.nodes.get(node.parentId);
    if (!parent?.children) return [];
    return parent.children
      .filter((id) => id !== node.id)
      .map((id) => this.nodes.get(id))
      .filter((n): n is UINode => n !== undefined);
  }

  /**
   * Find nodes that share the same parent container bounds.
   * Used when explicit parent IDs aren't available (e.g., DOM elements).
   */
  findSiblingsInContainer(node: UINode, containerBounds: Bounds): UINode[] {
    return this.findInRegion(containerBounds).filter((n) => n.id !== node.id);
  }

  computeAlignment(nodes: UINode[], tolerance = 2): AlignmentReport {
    const horizontalGroups: AlignmentGroup[] = [];
    const verticalGroups: AlignmentGroup[] = [];
    const aligned = new Set<string>();

    // Group by left edge (vertical alignment)
    const leftEdges = new Map<number, UINode[]>();
    for (const node of nodes) {
      const key = Math.round(node.bounds.x / tolerance) * tolerance;
      if (!leftEdges.has(key)) leftEdges.set(key, []);
      leftEdges.get(key)!.push(node);
    }
    for (const [pos, groupNodes] of leftEdges) {
      if (groupNodes.length >= 2) {
        verticalGroups.push({ axis: 'vertical', position: pos, tolerance, nodes: groupNodes });
        groupNodes.forEach((n) => aligned.add(n.id));
      }
    }

    // Group by top edge (horizontal alignment)
    const topEdges = new Map<number, UINode[]>();
    for (const node of nodes) {
      const key = Math.round(node.bounds.y / tolerance) * tolerance;
      if (!topEdges.has(key)) topEdges.set(key, []);
      topEdges.get(key)!.push(node);
    }
    for (const [pos, groupNodes] of topEdges) {
      if (groupNodes.length >= 2) {
        horizontalGroups.push({ axis: 'horizontal', position: pos, tolerance, nodes: groupNodes });
        groupNodes.forEach((n) => aligned.add(n.id));
      }
    }

    const misaligned = nodes.filter((n) => !aligned.has(n.id));
    return { horizontalGroups, verticalGroups, misaligned };
  }

  detectSpacingInconsistencies(tolerance = 2): SpacingIssue[] {
    const issues: SpacingIssue[] = [];
    const allNodes = this.getAllNodes();

    // Group siblings by parent
    const parentGroups = new Map<string, UINode[]>();
    for (const node of allNodes) {
      const key = node.parentId || '__root__';
      if (!parentGroups.has(key)) parentGroups.set(key, []);
      parentGroups.get(key)!.push(node);
    }

    for (const siblings of parentGroups.values()) {
      if (siblings.length < 3) continue;

      // Sort by x position for horizontal spacing
      const byX = [...siblings].sort((a, b) => a.bounds.x - b.bounds.x);
      const hGaps: number[] = [];
      for (let i = 1; i < byX.length; i++) {
        const gap = byX[i].bounds.x - (byX[i - 1].bounds.x + byX[i - 1].bounds.width);
        if (gap > 0) hGaps.push(gap);
      }

      if (hGaps.length >= 2) {
        const median = [...hGaps].sort((a, b) => a - b)[Math.floor(hGaps.length / 2)];
        for (let i = 1; i < byX.length; i++) {
          const gap = byX[i].bounds.x - (byX[i - 1].bounds.x + byX[i - 1].bounds.width);
          if (gap > 0 && Math.abs(gap - median) > tolerance) {
            issues.push({
              nodeA: byX[i - 1],
              nodeB: byX[i],
              expected: median,
              actual: gap,
              axis: 'horizontal',
            });
          }
        }
      }

      // Sort by y position for vertical spacing
      const byY = [...siblings].sort((a, b) => a.bounds.y - b.bounds.y);
      const vGaps: number[] = [];
      for (let i = 1; i < byY.length; i++) {
        const gap = byY[i].bounds.y - (byY[i - 1].bounds.y + byY[i - 1].bounds.height);
        if (gap > 0) vGaps.push(gap);
      }

      if (vGaps.length >= 2) {
        const median = [...vGaps].sort((a, b) => a - b)[Math.floor(vGaps.length / 2)];
        for (let i = 1; i < byY.length; i++) {
          const gap = byY[i].bounds.y - (byY[i - 1].bounds.y + byY[i - 1].bounds.height);
          if (gap > 0 && Math.abs(gap - median) > tolerance) {
            issues.push({
              nodeA: byY[i - 1],
              nodeB: byY[i],
              expected: median,
              actual: gap,
              axis: 'vertical',
            });
          }
        }
      }
    }

    return issues;
  }
}
