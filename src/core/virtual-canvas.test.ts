import { describe, it, expect } from 'vitest';
import { VirtualCanvas } from './virtual-canvas.js';
import type { UINode, DOMElementStyle, DesignNode, Viewport } from './types.js';

const viewport: Viewport = { width: 1280, height: 800 };

function makeNode(id: string, x: number, y: number, w: number, h: number, parentId?: string): UINode {
  return { id, name: id, bounds: { x, y, width: w, height: h }, type: 'FRAME', parentId };
}

describe('VirtualCanvas', () => {
  it('inserts and retrieves nodes', () => {
    const canvas = new VirtualCanvas(viewport);
    const node = makeNode('a', 10, 10, 100, 50);
    canvas.insert(node);
    expect(canvas.getNode('a')).toBe(node);
    expect(canvas.getAllNodes()).toHaveLength(1);
  });

  it('findAt returns nodes containing the point', () => {
    const canvas = new VirtualCanvas(viewport);
    canvas.insert(makeNode('a', 0, 0, 100, 100));
    canvas.insert(makeNode('b', 200, 200, 50, 50));

    expect(canvas.findAt(50, 50).map((n) => n.id)).toEqual(['a']);
    expect(canvas.findAt(225, 225).map((n) => n.id)).toEqual(['b']);
    expect(canvas.findAt(150, 150)).toHaveLength(0);
  });

  it('findOverlapping returns overlapping nodes', () => {
    const canvas = new VirtualCanvas(viewport);
    canvas.insert(makeNode('a', 0, 0, 100, 100));
    canvas.insert(makeNode('b', 50, 50, 100, 100));
    canvas.insert(makeNode('c', 300, 300, 50, 50));

    const results = canvas.findOverlapping({ x: 40, y: 40, width: 20, height: 20 });
    const ids = results.map((n) => n.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('findInRegion returns only fully contained nodes', () => {
    const canvas = new VirtualCanvas(viewport);
    canvas.insert(makeNode('a', 10, 10, 20, 20));
    canvas.insert(makeNode('b', 50, 50, 100, 100)); // extends beyond region

    const results = canvas.findInRegion({ x: 0, y: 0, width: 60, height: 60 });
    expect(results.map((n) => n.id)).toEqual(['a']);
  });

  it('getParent and getSiblings work with parent relationships', () => {
    const canvas = new VirtualCanvas(viewport);
    const parent = makeNode('parent', 0, 0, 400, 400);
    parent.children = ['child1', 'child2', 'child3'];
    canvas.insert(parent);
    canvas.insert(makeNode('child1', 10, 10, 100, 50, 'parent'));
    canvas.insert(makeNode('child2', 120, 10, 100, 50, 'parent'));
    canvas.insert(makeNode('child3', 230, 10, 100, 50, 'parent'));

    const child1 = canvas.getNode('child1')!;
    expect(canvas.getParent(child1)?.id).toBe('parent');
    const siblings = canvas.getSiblings(child1);
    expect(siblings.map((s) => s.id).sort()).toEqual(['child2', 'child3']);
  });

  it('fromDOMStyles creates canvas from DOM styles', () => {
    const styles: DOMElementStyle[] = [
      { selector: '.btn', tagName: 'BUTTON', bounds: { x: 10, y: 10, width: 100, height: 40 }, computedStyles: {} },
      { selector: '.text', tagName: 'P', bounds: { x: 10, y: 60, width: 200, height: 20 }, computedStyles: {} },
    ];
    const canvas = VirtualCanvas.fromDOMStyles(styles, viewport);
    expect(canvas.getAllNodes()).toHaveLength(2);
    expect(canvas.findAt(50, 25).map((n) => n.id)).toEqual(['.btn']);
  });

  it('fromDesignNodes creates canvas from design tree', () => {
    const nodes: DesignNode[] = [
      {
        id: 'frame',
        name: 'Frame',
        type: 'FRAME',
        bounds: { x: 0, y: 0, width: 400, height: 400 },
        children: [
          {
            id: 'btn',
            name: 'Button',
            type: 'BUTTON',
            bounds: { x: 10, y: 10, width: 100, height: 40 },
            children: [],
          },
        ],
      },
    ];
    const canvas = VirtualCanvas.fromDesignNodes(nodes, viewport);
    expect(canvas.getAllNodes()).toHaveLength(2);
    const btn = canvas.getNode('btn')!;
    expect(btn.parentId).toBe('frame');
  });

  it('computeAlignment detects aligned elements', () => {
    const canvas = new VirtualCanvas(viewport);
    const nodes = [
      makeNode('a', 10, 10, 100, 50),
      makeNode('b', 10, 70, 100, 50),
      makeNode('c', 10, 130, 100, 50),
      makeNode('d', 200, 15, 100, 50), // not aligned with others
    ];
    nodes.forEach((n) => canvas.insert(n));

    const report = canvas.computeAlignment(nodes);
    expect(report.verticalGroups.length).toBeGreaterThanOrEqual(1);
    const leftAligned = report.verticalGroups.find((g) => g.position === 10);
    expect(leftAligned?.nodes).toHaveLength(3);
  });

  it('detectSpacingInconsistencies finds inconsistent gaps', () => {
    const canvas = new VirtualCanvas(viewport);
    // Three siblings with consistent 10px gap, then one with 30px gap
    const parent = makeNode('parent', 0, 0, 500, 100);
    parent.children = ['a', 'b', 'c', 'd'];
    canvas.insert(parent);
    canvas.insert(makeNode('a', 0, 0, 100, 50, 'parent'));
    canvas.insert(makeNode('b', 110, 0, 100, 50, 'parent'));   // 10px gap
    canvas.insert(makeNode('c', 220, 0, 100, 50, 'parent'));   // 10px gap
    canvas.insert(makeNode('d', 350, 0, 100, 50, 'parent'));   // 30px gap

    const issues = canvas.detectSpacingInconsistencies();
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues.some((i) => i.nodeB.id === 'd')).toBe(true);
  });

  it('findSiblingsInContainer finds co-located nodes', () => {
    const canvas = new VirtualCanvas(viewport);
    canvas.insert(makeNode('a', 10, 10, 50, 50));
    canvas.insert(makeNode('b', 70, 10, 50, 50));
    canvas.insert(makeNode('c', 300, 300, 50, 50));

    const container = { x: 0, y: 0, width: 200, height: 100 };
    const a = canvas.getNode('a')!;
    const siblings = canvas.findSiblingsInContainer(a, container);
    expect(siblings.map((n) => n.id)).toEqual(['b']);
  });
});
