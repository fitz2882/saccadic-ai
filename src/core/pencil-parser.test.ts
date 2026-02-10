import { describe, it, expect } from 'vitest';
import { PencilParser } from './pencil-parser.js';
import type { PenFile, PenNode } from './pencil-types.js';

function makeFrame(overrides: Partial<PenNode> = {}): PenNode {
  return {
    type: 'frame',
    id: 'root',
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    ...overrides,
  };
}

function makePenFile(children: PenNode[], variables?: PenFile['variables']): PenFile {
  return { version: '2.6', children, variables };
}

describe('PencilParser', () => {
  const parser = new PencilParser();

  // ── 1. Variable resolution ──

  describe('variable resolution', () => {
    it('resolves simple variables', () => {
      const pen = makePenFile(
        [makeFrame({
          children: [{
            type: 'rectangle', id: 'r1', width: 100, height: 50,
            fill: '$--primary',
          }],
        })],
        { '--primary': { type: 'color', value: '#14B8A6' } }
      );
      const state = parser.parse(pen);
      const rect = state.nodes[0].children[0];
      expect(rect.fills).toEqual([{ type: 'SOLID', color: '#14B8A6' }]);
    });

    it('resolves themed variables with matching theme', () => {
      const pen = makePenFile(
        [makeFrame({
          children: [{
            type: 'rectangle', id: 'r1', width: 100, height: 50,
            fill: '$--bg',
          }],
        })],
        {
          '--bg': {
            type: 'color',
            value: [
              { value: '#FFFFFF', theme: { name: 'Light' } },
              { value: '#1A1A1A', theme: { name: 'Dark' } },
            ],
          },
        }
      );

      const light = parser.parse(pen, { themeMode: 'Light' });
      expect(light.nodes[0].children[0].fills).toEqual([{ type: 'SOLID', color: '#FFFFFF' }]);

      const dark = parser.parse(pen, { themeMode: 'Dark' });
      expect(dark.nodes[0].children[0].fills).toEqual([{ type: 'SOLID', color: '#1A1A1A' }]);
    });

    it('uses first themed value when no theme matches', () => {
      const pen = makePenFile(
        [makeFrame({
          children: [{
            type: 'rectangle', id: 'r1', width: 100, height: 50,
            fill: '$--bg',
          }],
        })],
        {
          '--bg': {
            type: 'color',
            value: [
              { value: '#FFFFFF', theme: { name: 'Light' } },
              { value: '#1A1A1A', theme: { name: 'Dark' } },
            ],
          },
        }
      );
      const result = parser.parse(pen, { themeMode: 'HighContrast' });
      expect(result.nodes[0].children[0].fills).toEqual([{ type: 'SOLID', color: '#FFFFFF' }]);
    });
  });

  // ── 2. Padding parsing ──

  describe('padding parsing', () => {
    it('normalizes number padding to all 4 sides', () => {
      expect(parser.normalizePadding(16)).toEqual({ top: 16, right: 16, bottom: 16, left: 16 });
    });

    it('normalizes 2-tuple [v, h]', () => {
      expect(parser.normalizePadding([10, 20])).toEqual({ top: 10, right: 20, bottom: 10, left: 20 });
    });

    it('normalizes 4-tuple [t, r, b, l]', () => {
      expect(parser.normalizePadding([1, 2, 3, 4])).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
    });

    it('returns zero for undefined', () => {
      expect(parser.normalizePadding(undefined)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    });
  });

  // ── 3. Size parsing ──

  describe('size parsing', () => {
    it('handles numeric sizes', () => {
      const pen = makePenFile([makeFrame({
        children: [{ type: 'rectangle', id: 'r1', width: 200, height: 100 }],
      })]);
      const state = parser.parse(pen);
      const rect = state.nodes[0].children[0];
      expect(rect.bounds.width).toBe(200);
      expect(rect.bounds.height).toBe(100);
    });

    it('handles fill_container', () => {
      const pen = makePenFile([makeFrame({
        width: 400, height: 300,
        children: [{ type: 'rectangle', id: 'r1', width: 'fill_container', height: 'fill_container' }],
      })]);
      const state = parser.parse(pen);
      const rect = state.nodes[0].children[0];
      expect(rect.bounds.width).toBe(400);
      expect(rect.bounds.height).toBe(300);
    });

    it('handles fill_container(N) with min', () => {
      const pen = makePenFile([makeFrame({
        width: 400, height: 300,
        children: [{ type: 'rectangle', id: 'r1', width: 'fill_container(200)', height: 'fill_container(150)' }],
      })]);
      const state = parser.parse(pen);
      const rect = state.nodes[0].children[0];
      expect(rect.bounds.width).toBe(200);
      expect(rect.bounds.height).toBe(150);
    });

    it('handles fit_content', () => {
      const pen = makePenFile([makeFrame({
        width: 'fit_content', height: 'fit_content',
        children: [
          { type: 'rectangle', id: 'r1', width: 100, height: 50 },
          { type: 'rectangle', id: 'r2', width: 100, height: 50 },
        ],
      })]);
      const state = parser.parse(pen);
      // Horizontal layout: width = sum of children widths, height = max child height
      expect(state.nodes[0].bounds.width).toBe(200);
      expect(state.nodes[0].bounds.height).toBe(50);
    });

    it('handles fit_content(N) with max cap', () => {
      const pen = makePenFile([makeFrame({
        width: 'fit_content(150)', height: 'fit_content(30)',
        children: [
          { type: 'rectangle', id: 'r1', width: 100, height: 50 },
          { type: 'rectangle', id: 'r2', width: 100, height: 50 },
        ],
      })]);
      const state = parser.parse(pen);
      expect(state.nodes[0].bounds.width).toBe(150);
      expect(state.nodes[0].bounds.height).toBe(30);
    });
  });

  // ── 4. Node type mapping ──

  describe('node type mapping', () => {
    const types: Array<[PenNode['type'], string]> = [
      ['frame', 'FRAME'],
      ['text', 'TEXT'],
      ['rectangle', 'RECTANGLE'],
      ['ellipse', 'ELLIPSE'],
      ['image', 'IMAGE'],
      ['ref', 'INSTANCE'],
      ['icon_font', 'VECTOR'],
      ['path', 'VECTOR'],
      ['line', 'VECTOR'],
    ];

    for (const [penType, expected] of types) {
      it(`maps ${penType} → ${expected}`, () => {
        const node: PenNode = penType === 'ref'
          ? { type: 'ref', id: 'n1', ref: 'nonexistent', width: 50, height: 50 }
          : { type: penType, id: 'n1', width: 50, height: 50 };
        const pen = makePenFile([makeFrame({ children: [node] })]);
        const state = parser.parse(pen);
        expect(state.nodes[0].children[0].type).toBe(expected);
      });
    }
  });

  // ── 5. Fill parsing ──

  describe('fill parsing', () => {
    it('parses hex string', () => {
      const pen = makePenFile([makeFrame({
        children: [{ type: 'rectangle', id: 'r1', width: 50, height: 50, fill: '#FF0000' }],
      })]);
      const state = parser.parse(pen);
      expect(state.nodes[0].children[0].fills).toEqual([{ type: 'SOLID', color: '#FF0000' }]);
    });

    it('resolves $-- variable reference', () => {
      const pen = makePenFile(
        [makeFrame({
          children: [{ type: 'rectangle', id: 'r1', width: 50, height: 50, fill: '$--accent' }],
        })],
        { '--accent': { type: 'color', value: '#00FF00' } }
      );
      const state = parser.parse(pen);
      expect(state.nodes[0].children[0].fills).toEqual([{ type: 'SOLID', color: '#00FF00' }]);
    });

    it('handles fill object with enabled:false', () => {
      const pen = makePenFile([makeFrame({
        children: [{
          type: 'rectangle', id: 'r1', width: 50, height: 50,
          fill: { type: 'solid', color: '#FF0000', enabled: false },
        }],
      })]);
      const state = parser.parse(pen);
      expect(state.nodes[0].children[0].fills).toBeUndefined();
    });

    it('handles transparent fill', () => {
      const pen = makePenFile([makeFrame({
        children: [{ type: 'rectangle', id: 'r1', width: 50, height: 50, fill: 'transparent' }],
      })]);
      const state = parser.parse(pen);
      expect(state.nodes[0].children[0].fills).toBeUndefined();
    });
  });

  // ── 6. Layout: vertical ──

  describe('vertical layout', () => {
    it('stacks children vertically with gap', () => {
      const pen = makePenFile([makeFrame({
        layout: 'vertical', gap: 10,
        children: [
          { type: 'rectangle', id: 'c1', width: 100, height: 40 },
          { type: 'rectangle', id: 'c2', width: 100, height: 40 },
          { type: 'rectangle', id: 'c3', width: 100, height: 40 },
        ],
      })]);
      const state = parser.parse(pen);
      const children = state.nodes[0].children;
      expect(children[0].bounds.y).toBe(0);
      expect(children[1].bounds.y).toBe(50); // 40 + 10
      expect(children[2].bounds.y).toBe(100); // 40 + 10 + 40 + 10
    });
  });

  // ── 7. Layout: horizontal ──

  describe('horizontal layout', () => {
    it('stacks children horizontally with gap', () => {
      const pen = makePenFile([makeFrame({
        gap: 10,
        children: [
          { type: 'rectangle', id: 'c1', width: 60, height: 40 },
          { type: 'rectangle', id: 'c2', width: 60, height: 40 },
          { type: 'rectangle', id: 'c3', width: 60, height: 40 },
        ],
      })]);
      const state = parser.parse(pen);
      const children = state.nodes[0].children;
      expect(children[0].bounds.x).toBe(0);
      expect(children[1].bounds.x).toBe(70); // 60 + 10
      expect(children[2].bounds.x).toBe(140); // 60 + 10 + 60 + 10
    });
  });

  // ── 8. Layout: none (absolute) ──

  describe('absolute layout (none)', () => {
    it('uses explicit x,y relative to parent', () => {
      const pen = makePenFile([makeFrame({
        layout: 'none', x: 10, y: 20,
        children: [
          { type: 'rectangle', id: 'c1', x: 5, y: 10, width: 50, height: 50 },
          { type: 'rectangle', id: 'c2', x: 100, y: 50, width: 50, height: 50 },
        ],
      })]);
      const state = parser.parse(pen);
      const children = state.nodes[0].children;
      expect(children[0].bounds.x).toBe(15); // 10 + 5
      expect(children[0].bounds.y).toBe(30); // 20 + 10
      expect(children[1].bounds.x).toBe(110); // 10 + 100
      expect(children[1].bounds.y).toBe(70); // 20 + 50
    });
  });

  // ── 9. Nested layouts ──

  describe('nested layouts', () => {
    it('vertical frame containing horizontal row', () => {
      const pen = makePenFile([{
        type: 'frame', id: 'outer', width: 400, height: 300,
        layout: 'vertical', gap: 10,
        children: [
          {
            type: 'frame', id: 'row', width: 400, height: 50,
            gap: 5,
            children: [
              { type: 'rectangle', id: 'a', width: 40, height: 50 },
              { type: 'rectangle', id: 'b', width: 40, height: 50 },
            ],
          },
          { type: 'rectangle', id: 'below', width: 400, height: 100 },
        ],
      }]);
      const state = parser.parse(pen);
      const outer = state.nodes[0];
      const row = outer.children[0];
      const below = outer.children[1];

      // row items horizontal
      expect(row.children[0].bounds.x).toBe(0);
      expect(row.children[1].bounds.x).toBe(45); // 40 + 5

      // below is after row in vertical layout
      expect(below.bounds.y).toBe(60); // 50 + 10
    });
  });

  // ── 10. fill_container sizing ──

  describe('fill_container sizing', () => {
    it('child fills parent minus padding', () => {
      const pen = makePenFile([makeFrame({
        width: 400, height: 300, padding: 20,
        children: [{ type: 'rectangle', id: 'r1', width: 'fill_container', height: 'fill_container' }],
      })]);
      const state = parser.parse(pen);
      const rect = state.nodes[0].children[0];
      expect(rect.bounds.width).toBe(360); // 400 - 20 - 20
      expect(rect.bounds.height).toBe(260); // 300 - 20 - 20
    });
  });

  // ── 11. fit_content sizing ──

  describe('fit_content sizing', () => {
    it('parent shrinks to children in horizontal', () => {
      const pen = makePenFile([{
        type: 'frame', id: 'fc', width: 'fit_content', height: 'fit_content',
        gap: 10,
        children: [
          { type: 'rectangle', id: 'a', width: 50, height: 30 },
          { type: 'rectangle', id: 'b', width: 80, height: 40 },
        ],
      }]);
      const state = parser.parse(pen);
      expect(state.nodes[0].bounds.width).toBe(140); // 50 + 10 + 80
      expect(state.nodes[0].bounds.height).toBe(40); // max(30, 40)
    });
  });

  // ── 12. Ref resolution ──

  describe('ref resolution', () => {
    it('clones prototype and applies overrides + descendants', () => {
      const pen = makePenFile([
        {
          type: 'frame', id: 'btn-proto', reusable: true,
          width: 120, height: 40, fill: '#0000FF',
          children: [
            { type: 'text', id: 'btn-label', content: 'Click', fontSize: 14, fontFamily: 'Inter', width: 50, height: 20 },
          ],
        },
        {
          type: 'ref', id: 'btn-instance', ref: 'btn-proto',
          x: 10, y: 20, width: 150,
          descendants: {
            'btn-label': { content: 'Submit' },
          },
        },
      ]);
      const state = parser.parse(pen);
      // Should have 2 top-level nodes (prototype + instance)
      expect(state.nodes.length).toBe(2);
      const instance = state.nodes[1];
      expect(instance.type).toBe('INSTANCE');
      expect(instance.bounds.x).toBe(10);
      expect(instance.bounds.y).toBe(20);
      expect(instance.bounds.width).toBe(150);
    });
  });

  // ── 13. Token extraction ──

  describe('token extraction', () => {
    it('maps variables to DesignTokens', () => {
      const pen = makePenFile([makeFrame()], {
        '--primary': { type: 'color', value: '#14B8A6' },
        '--radius-m': { type: 'number', value: 24 },
        '--spacing-lg': { type: 'number', value: 32 },
        '--font-secondary': { type: 'string', value: 'Inter' },
      });
      const state = parser.parse(pen);
      expect(state.tokens).toBeDefined();
      expect(state.tokens!.colors['--primary']).toBe('#14B8A6');
      expect(state.tokens!.radii['--radius-m']).toBe('24');
      expect(state.tokens!.spacing['--spacing-lg']).toBe('32');
      expect(state.tokens!.typography['--font-secondary']).toBeDefined();
      expect(state.tokens!.typography['--font-secondary'].fontFamily).toBe('Inter');
    });
  });

  // ── 14. Typography conversion ──

  describe('typography conversion', () => {
    it('converts lineHeight multiplier to px', () => {
      const pen = makePenFile([makeFrame({
        children: [{
          type: 'text', id: 't1',
          fontFamily: 'Inter', fontSize: 20, fontWeight: 700,
          lineHeight: 1.5, letterSpacing: 0.5,
          content: 'Hello', width: 100, height: 30,
        }],
      })]);
      const state = parser.parse(pen);
      const text = state.nodes[0].children[0];
      expect(text.typography).toBeDefined();
      expect(text.typography!.fontFamily).toBe('Inter');
      expect(text.typography!.fontSize).toBe(20);
      expect(text.typography!.fontWeight).toBe(700);
      expect(text.typography!.lineHeight).toBe(30); // 1.5 * 20
      expect(text.typography!.letterSpacing).toBe(0.5);
    });
  });

  // ── 15. Frame selection ──

  describe('frame selection', () => {
    it('selects frame by name', () => {
      const pen = makePenFile([
        makeFrame({ id: 'f1', name: 'Home', width: 400, height: 300 }),
        makeFrame({ id: 'f2', name: 'About', width: 400, height: 300 }),
      ]);
      const state = parser.parse(pen, { frameName: 'Home' });
      expect(state.nodes.length).toBe(1);
      expect(state.nodes[0].name).toBe('Home');
    });

    it('selects frame by id', () => {
      const pen = makePenFile([
        makeFrame({ id: 'f1', name: 'Home' }),
        makeFrame({ id: 'f2', name: 'About' }),
      ]);
      const state = parser.parse(pen, { frameName: 'f1' });
      expect(state.nodes.length).toBe(1);
      expect(state.nodes[0].id).toBe('f1');
    });
  });

  // ── Edge cases ──

  describe('edge cases', () => {
    it('handles empty children', () => {
      const pen = makePenFile([makeFrame({ children: [] })]);
      const state = parser.parse(pen);
      expect(state.nodes.length).toBe(1);
      expect(state.nodes[0].children.length).toBe(0);
    });

    it('handles missing variables section', () => {
      const pen = makePenFile([makeFrame()]);
      const state = parser.parse(pen);
      expect(state.tokens).toBeUndefined();
    });

    it('prevents circular ref expansion', () => {
      const pen = makePenFile([
        { type: 'frame', id: 'a', reusable: true, width: 100, height: 100, children: [{ type: 'ref', id: 'b', ref: 'a' }] },
      ]);
      // Should not infinite loop
      const state = parser.parse(pen);
      expect(state.nodes.length).toBe(1);
    });

    it('handles no fill on node', () => {
      const pen = makePenFile([makeFrame({
        children: [{ type: 'rectangle', id: 'r1', width: 50, height: 50 }],
      })]);
      const state = parser.parse(pen);
      expect(state.nodes[0].children[0].fills).toBeUndefined();
    });
  });
});
