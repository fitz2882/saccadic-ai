/**
 * Tests for Design Parser module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DesignParser } from './design-parser.js';
import type { DesignTokens } from './types.js';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ── Mock Figma API Responses ──

const mockFigmaFile = {
  name: 'Test Design',
  document: {
    id: '0:1',
    name: 'Page 1',
    type: 'CANVAS',
    children: [
      {
        id: '1:2',
        name: 'Frame 1',
        type: 'FRAME',
        absoluteBoundingBox: { x: 0, y: 0, width: 375, height: 812 },
        fills: [
          {
            type: 'SOLID',
            color: { r: 1, g: 1, b: 1, a: 1 },
          },
        ],
        children: [
          {
            id: '1:3',
            name: 'Button',
            type: 'RECTANGLE',
            absoluteBoundingBox: { x: 20, y: 100, width: 335, height: 48 },
            fills: [
              {
                type: 'SOLID',
                color: { r: 0.2, g: 0.4, b: 0.8, a: 1 },
              },
            ],
            strokes: [
              {
                type: 'SOLID',
                color: { r: 0, g: 0, b: 0, a: 0.1 },
              },
            ],
            strokeWeight: 2,
            strokeAlign: 'INSIDE',
            cornerRadius: 8,
            effects: [
              {
                type: 'DROP_SHADOW',
                visible: true,
                color: { r: 0, g: 0, b: 0, a: 0.25 },
                offset: { x: 0, y: 4 },
                radius: 8,
                spread: 0,
              },
            ],
            children: [],
          },
          {
            id: '1:4',
            name: 'Text',
            type: 'TEXT',
            absoluteBoundingBox: { x: 40, y: 116, width: 295, height: 16 },
            fills: [
              {
                type: 'SOLID',
                color: { r: 1, g: 1, b: 1, a: 1 },
              },
            ],
            style: {
              fontFamily: 'Inter',
              fontSize: 16,
              fontWeight: 600,
              lineHeightPx: 24,
              letterSpacing: 0,
              textAlignHorizontal: 'CENTER',
            },
            children: [],
          },
        ],
      },
    ],
  },
};

const mockFigmaNodesResponse = {
  nodes: {
    '1:2': {
      document: mockFigmaFile.document.children[0],
    },
  },
};

const mockFigmaImagesResponse = {
  images: {
    '1:2': 'https://example.com/image.png',
  },
};

const mockFigmaVariablesResponse = {
  meta: {
    variableCollections: {
      'VariableCollectionId:1': {
        id: 'VariableCollectionId:1',
        name: 'Colors',
        modes: [{ modeId: 'mode1', name: 'Light' }],
      },
    },
    variables: {
      'VariableID:1': {
        id: 'VariableID:1',
        name: 'Primary Color',
        resolvedType: 'COLOR',
        valuesByMode: {
          mode1: { r: 0.2, g: 0.4, b: 0.8, a: 1 },
        },
      },
      'VariableID:2': {
        id: 'VariableID:2',
        name: 'Base Spacing',
        resolvedType: 'FLOAT',
        valuesByMode: {
          mode1: 8,
        },
      },
      'VariableID:3': {
        id: 'VariableID:3',
        name: 'Border Radius',
        resolvedType: 'FLOAT',
        valuesByMode: {
          mode1: 4,
        },
      },
    },
  },
};

// Mock PNG image data (1x1 pixel)
const mockImageBuffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

// ── Tests ──

describe('DesignParser', () => {
  let parser: DesignParser;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    parser = new DesignParser('test-token');
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Color Conversion', () => {
    it('converts RGBA floats to hex (opaque)', () => {
      const hex = parser.rgbaToHex(1, 1, 1, 1);
      expect(hex).toBe('#FFFFFF');
    });

    it('converts RGBA floats to hex (with alpha)', () => {
      const hex = parser.rgbaToHex(1, 0, 0, 0.5);
      expect(hex).toBe('#FF000080');
    });

    it('converts blue color correctly', () => {
      const hex = parser.rgbaToHex(0.2, 0.4, 0.8, 1);
      expect(hex).toBe('#3366CC');
    });

    it('converts black color correctly', () => {
      const hex = parser.rgbaToHex(0, 0, 0, 1);
      expect(hex).toBe('#000000');
    });

    it('handles edge cases with precision', () => {
      const hex = parser.rgbaToHex(0.99999, 0.5, 0.00001, 1);
      expect(hex).toBe('#FF8000');
    });
  });

  describe('Figma Node Parsing', () => {
    it('parses a simple FRAME node', () => {
      const figmaNode = {
        id: '1:1',
        name: 'Test Frame',
        type: 'FRAME',
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 200 },
        fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }],
        children: [],
      };

      const parsed = parser.parseFigmaNode(figmaNode);

      expect(parsed.id).toBe('1:1');
      expect(parsed.name).toBe('Test Frame');
      expect(parsed.type).toBe('FRAME');
      expect(parsed.bounds).toEqual({ x: 0, y: 0, width: 100, height: 200 });
      expect(parsed.fills).toHaveLength(1);
      expect(parsed.fills![0].color).toBe('#FF0000');
      expect(parsed.children).toHaveLength(0);
    });

    it('parses TEXT node with typography', () => {
      const figmaNode = {
        id: '1:2',
        name: 'Headline',
        type: 'TEXT',
        absoluteBoundingBox: { x: 10, y: 20, width: 300, height: 40 },
        style: {
          fontFamily: 'Roboto',
          fontSize: 24,
          fontWeight: 700,
          lineHeightPx: 32,
          letterSpacing: -0.5,
          textAlignHorizontal: 'LEFT',
        },
        fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
        children: [],
      };

      const parsed = parser.parseFigmaNode(figmaNode);

      expect(parsed.type).toBe('TEXT');
      expect(parsed.typography).toBeDefined();
      expect(parsed.typography!.fontFamily).toBe('Roboto');
      expect(parsed.typography!.fontSize).toBe(24);
      expect(parsed.typography!.fontWeight).toBe(700);
      expect(parsed.typography!.lineHeight).toBe(32);
      expect(parsed.typography!.letterSpacing).toBe(-0.5);
      expect(parsed.typography!.textAlign).toBe('LEFT');
      expect(parsed.typography!.color).toBe('#000000');
    });

    it('parses RECTANGLE with strokes and effects', () => {
      const figmaNode = {
        id: '1:3',
        name: 'Card',
        type: 'RECTANGLE',
        absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 150 },
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
        strokes: [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5, a: 1 } }],
        strokeWeight: 1,
        strokeAlign: 'INSIDE',
        cornerRadius: 12,
        effects: [
          {
            type: 'DROP_SHADOW',
            visible: true,
            color: { r: 0, g: 0, b: 0, a: 0.1 },
            offset: { x: 0, y: 2 },
            radius: 4,
            spread: 0,
          },
        ],
        children: [],
      };

      const parsed = parser.parseFigmaNode(figmaNode);

      expect(parsed.type).toBe('RECTANGLE');
      expect(parsed.strokes).toHaveLength(1);
      expect(parsed.strokes![0].color).toBe('#808080');
      expect(parsed.strokes![0].weight).toBe(1);
      expect(parsed.strokes![0].position).toBe('INSIDE');
      expect(parsed.cornerRadius).toBe(12);
      expect(parsed.effects).toHaveLength(1);
      expect(parsed.effects![0].type).toBe('DROP_SHADOW');
      expect(parsed.effects![0].blur).toBe(4);
      expect(parsed.effects![0].offset).toEqual({ x: 0, y: 2 });
    });

    it('parses nested children recursively', () => {
      const figmaNode = {
        id: '1:1',
        name: 'Parent',
        type: 'FRAME',
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        children: [
          {
            id: '1:2',
            name: 'Child 1',
            type: 'RECTANGLE',
            absoluteBoundingBox: { x: 10, y: 10, width: 30, height: 30 },
            children: [],
          },
          {
            id: '1:3',
            name: 'Child 2',
            type: 'ELLIPSE',
            absoluteBoundingBox: { x: 50, y: 50, width: 40, height: 40 },
            children: [],
          },
        ],
      };

      const parsed = parser.parseFigmaNode(figmaNode);

      expect(parsed.children).toHaveLength(2);
      expect(parsed.children[0].id).toBe('1:2');
      expect(parsed.children[0].type).toBe('RECTANGLE');
      expect(parsed.children[1].id).toBe('1:3');
      expect(parsed.children[1].type).toBe('ELLIPSE');
    });

    it('parses individual corner radii', () => {
      const figmaNode = {
        id: '1:1',
        name: 'Custom Corners',
        type: 'RECTANGLE',
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        rectangleCornerRadii: [8, 16, 24, 32],
        children: [],
      };

      const parsed = parser.parseFigmaNode(figmaNode);

      expect(parsed.cornerRadius).toEqual({
        topLeft: 8,
        topRight: 16,
        bottomRight: 24,
        bottomLeft: 32,
      });
    });

    it('parses uniform corner radii as number', () => {
      const figmaNode = {
        id: '1:1',
        name: 'Uniform Corners',
        type: 'RECTANGLE',
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        rectangleCornerRadii: [8, 8, 8, 8],
        children: [],
      };

      const parsed = parser.parseFigmaNode(figmaNode);

      expect(parsed.cornerRadius).toBe(8);
    });

    it('parses padding', () => {
      const figmaNode = {
        id: '1:1',
        name: 'Padded Frame',
        type: 'FRAME',
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        paddingTop: 16,
        paddingRight: 24,
        paddingBottom: 16,
        paddingLeft: 24,
        children: [],
      };

      const parsed = parser.parseFigmaNode(figmaNode);

      expect(parsed.padding).toEqual({
        top: 16,
        right: 24,
        bottom: 16,
        left: 24,
      });
    });

    it('parses layout properties', () => {
      const figmaNode = {
        id: '1:1',
        name: 'Auto Layout',
        type: 'FRAME',
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        layoutMode: 'VERTICAL' as const,
        itemSpacing: 12,
        children: [],
      };

      const parsed = parser.parseFigmaNode(figmaNode);

      expect(parsed.layoutMode).toBe('VERTICAL');
      expect(parsed.gap).toBe(12);
    });
  });

  describe('parseFromFigma', () => {
    it('fetches and parses entire Figma file', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFigmaFile,
      });

      const result = await parser.parseFromFigma('test-file-key');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.figma.com/v1/files/test-file-key',
        expect.objectContaining({
          headers: { 'X-Figma-Token': 'test-token' },
        })
      );

      expect(result.id).toBe('test-file-key');
      expect(result.name).toBe('Test Design');
      expect(result.viewport).toEqual({ width: 375, height: 812 });
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].name).toBe('Page 1');
    });

    it('fetches and parses specific node', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFigmaNodesResponse,
      });

      const result = await parser.parseFromFigma('test-file-key', '1:2');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.figma.com/v1/files/test-file-key/nodes?ids=1:2',
        expect.objectContaining({
          headers: { 'X-Figma-Token': 'test-token' },
        })
      );

      expect(result.id).toBe('test-file-key:1:2');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe('1:2');
    });

    it('throws error on API failure', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(parser.parseFromFigma('invalid-key')).rejects.toThrow(
        'Figma API error: 404 Not Found'
      );
    });

    it('throws error when node not found', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ nodes: {} }),
      });

      await expect(parser.parseFromFigma('test-file-key', 'missing-node')).rejects.toThrow(
        'Node missing-node not found'
      );
    });
  });

  describe('Caching', () => {
    it('caches parsed design state', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockFigmaFile,
      });

      // First call
      const result1 = await parser.parseFromFigma('cached-key');
      // Second call
      const result2 = await parser.parseFromFigma('cached-key');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result1).toBe(result2); // Same object reference
    });

    it('uses separate cache keys for different nodes', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFigmaFile,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFigmaNodesResponse,
        });

      await parser.parseFromFigma('file-key');
      await parser.parseFromFigma('file-key', '1:2');

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('getFigmaScreenshot', () => {
    it('fetches screenshot for specified node', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFigmaImagesResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => mockImageBuffer.buffer,
        });

      const screenshot = await parser.getFigmaScreenshot('test-file-key', '1:2');

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://api.figma.com/v1/images/test-file-key?ids=1:2&format=png&scale=2',
        expect.objectContaining({
          headers: { 'X-Figma-Token': 'test-token' },
        })
      );

      expect(screenshot).toBeInstanceOf(Buffer);
      expect(screenshot.length).toBeGreaterThan(0);
    });

    it('fetches default node when nodeId not specified', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockFigmaFile,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ images: { '0:1': 'https://example.com/image.png' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => mockImageBuffer.buffer,
        });

      const screenshot = await parser.getFigmaScreenshot('test-file-key');

      expect(screenshot).toBeInstanceOf(Buffer);
    });

    it('throws error when image not generated', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ images: {} }),
      });

      await expect(parser.getFigmaScreenshot('test-file-key', '1:2')).rejects.toThrow(
        'No image generated for node 1:2'
      );
    });
  });

  describe('extractTokensFromFigma', () => {
    it('extracts color and spacing tokens from Figma variables', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFigmaVariablesResponse,
      });

      const tokens = await parser.extractTokensFromFigma('test-file-key');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.figma.com/v1/files/test-file-key/variables/local',
        expect.objectContaining({
          headers: { 'X-Figma-Token': 'test-token' },
        })
      );

      expect(tokens.colors['primary-color']).toBe('#3366CC');
      expect(tokens.spacing['base-spacing']).toBe('8px');
      expect(tokens.radii['border-radius']).toBe('4px');
    });
  });

  describe('parseFromTokenFile', () => {
    let tempFilePath: string;

    afterEach(async () => {
      if (tempFilePath) {
        try {
          await fs.unlink(tempFilePath);
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    });

    it('parses W3C DTCG token file', async () => {
      const tokenData = {
        color: {
          primary: {
            $value: '#3366cc',
            $type: 'color',
            $description: 'Primary brand color',
          },
          secondary: {
            $value: '#ff6600',
            $type: 'color',
          },
        },
        spacing: {
          small: {
            $value: '8px',
            $type: 'spacing',
          },
          medium: {
            $value: '16px',
            $type: 'spacing',
          },
        },
        shadow: {
          card: {
            $value: '0 2px 4px rgba(0,0,0,0.1)',
            $type: 'shadow',
          },
        },
      };

      tempFilePath = join(tmpdir(), `test-tokens-${Date.now()}.json`);
      await fs.writeFile(tempFilePath, JSON.stringify(tokenData));

      const tokens = await parser.parseFromTokenFile(tempFilePath);

      expect(tokens.colors['color-primary']).toBe('#3366cc');
      expect(tokens.colors['color-secondary']).toBe('#ff6600');
      expect(tokens.spacing['spacing-small']).toBe('8px');
      expect(tokens.spacing['spacing-medium']).toBe('16px');
      expect(tokens.shadows['shadow-card']).toBe('0 2px 4px rgba(0,0,0,0.1)');
    });

    it('parses nested token groups', async () => {
      const tokenData = {
        color: {
          brand: {
            primary: {
              $value: '#3366cc',
              $type: 'color',
            },
            secondary: {
              $value: '#ff6600',
              $type: 'color',
            },
          },
          ui: {
            background: {
              $value: '#ffffff',
              $type: 'color',
            },
          },
        },
      };

      tempFilePath = join(tmpdir(), `test-nested-tokens-${Date.now()}.json`);
      await fs.writeFile(tempFilePath, JSON.stringify(tokenData));

      const tokens = await parser.parseFromTokenFile(tempFilePath);

      expect(tokens.colors['color-brand-primary']).toBe('#3366cc');
      expect(tokens.colors['color-brand-secondary']).toBe('#ff6600');
      expect(tokens.colors['color-ui-background']).toBe('#ffffff');
    });

    it('infers token types from names when $type missing', async () => {
      const tokenData = {
        'background-color': {
          $value: '#ffffff',
        },
        'base-spacing': {
          $value: '8px',
        },
        'border-radius': {
          $value: '4px',
        },
      };

      tempFilePath = join(tmpdir(), `test-inferred-tokens-${Date.now()}.json`);
      await fs.writeFile(tempFilePath, JSON.stringify(tokenData));

      const tokens = await parser.parseFromTokenFile(tempFilePath);

      expect(tokens.colors['background-color']).toBe('#ffffff');
      expect(tokens.spacing['base-spacing']).toBe('8px');
      expect(tokens.radii['border-radius']).toBe('4px');
    });

    it('parses typography tokens', async () => {
      const tokenData = {
        typography: {
          heading: {
            $value: {
              fontFamily: 'Inter',
              fontSize: '24px',
              fontWeight: '700',
              lineHeight: '32px',
              letterSpacing: '-0.5px',
            },
            $type: 'typography',
          },
        },
      };

      tempFilePath = join(tmpdir(), `test-typography-tokens-${Date.now()}.json`);
      await fs.writeFile(tempFilePath, JSON.stringify(tokenData));

      const tokens = await parser.parseFromTokenFile(tempFilePath);

      expect(tokens.typography['typography-heading']).toEqual({
        fontFamily: 'Inter',
        fontSize: '24px',
        fontWeight: '700',
        lineHeight: '32px',
        letterSpacing: '-0.5px',
      });
    });
  });
});
