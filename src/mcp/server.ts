#!/usr/bin/env node

/**
 * Saccadic AI MCP Server
 *
 * Minimal JSON-RPC 2.0 stdio server for visual feedback tools.
 * Does NOT use @modelcontextprotocol/sdk - implements protocol directly.
 */

import { createInterface } from 'readline';
import { ComparisonEngine } from '../core/comparison-engine.js';
import { ScreenshotEngine } from '../core/screenshot-engine.js';
import { DesignParser } from '../core/design-parser.js';
import { PencilParser } from '../core/pencil-parser.js';
import { PixelComparator } from '../core/pixel-comparator.js';
import { TokenVersioning } from '../core/token-versioning.js';
import { VLMComparator } from '../core/vlm-comparator.js';
import {
  STANDARD_VIEWPORTS,
} from '../core/types.js';
import type {
  CaptureScreenshotParams,
  LoadDesignParams,
  CompareDesignBuildParams,
  GetVisualDiffParams,
  GetDesignTokensParams,
  CompareDesignTokensParams,
  EvaluateWithVLMParams,
  DesignTokens,
  Viewport,
} from '../core/types.js';

// ── JSON-RPC 2.0 Types ──

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// JSON-RPC Error Codes
const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

// ── MCP Tool Definitions ──

const TOOLS = [
  {
    name: 'capture_screenshot',
    description: 'Capture a screenshot of a URL with optional viewport and selector targeting',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to capture',
        },
        viewport: {
          oneOf: [
            { type: 'string', enum: ['mobile-sm', 'mobile', 'tablet', 'desktop-sm', 'desktop', 'desktop-lg'] },
            {
              type: 'object',
              properties: {
                width: { type: 'number' },
                height: { type: 'number' },
                deviceScaleFactor: { type: 'number' },
              },
              required: ['width', 'height'],
            },
          ],
          description: 'Viewport preset name or custom viewport object',
        },
        selector: {
          type: 'string',
          description: 'CSS selector to capture a specific element',
        },
        fullPage: {
          type: 'boolean',
          description: 'Capture full page scroll height',
        },
        outputPath: {
          type: 'string',
          description: 'File path to save the screenshot PNG to disk',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'load_design',
    description: 'Parse a Figma design file, token file, or Pencil.dev .pen file into design state. Returns design node IDs. Add data-pen-id attributes to build HTML for accurate DOM comparison.',
    inputSchema: {
      type: 'object',
      properties: {
        figmaUrl: {
          type: 'string',
          description: 'Full Figma file URL',
        },
        figmaFileKey: {
          type: 'string',
          description: 'Figma file key (alternative to full URL)',
        },
        tokenFile: {
          type: 'string',
          description: 'Path to local design token file',
        },
        nodeId: {
          type: 'string',
          description: 'Specific Figma node ID to load',
        },
        pencilFile: {
          type: 'string',
          description: 'Path to Pencil.dev .pen design file',
        },
        pencilFrame: {
          type: 'string',
          description: 'Frame name/id to extract from .pen file',
        },
        pencilTheme: {
          type: 'string',
          description: 'Theme mode for .pen file (e.g., "Light", "Dark")',
        },
      },
    },
  },
  {
    name: 'compare_design_build',
    description: 'Run full comparison pipeline between design and build implementation. For best results, add data-pen-id attributes to build elements matching design node IDs from load_design.',
    inputSchema: {
      type: 'object',
      properties: {
        designSource: {
          type: 'object',
          properties: {
            figmaUrl: { type: 'string' },
            figmaFileKey: { type: 'string' },
            tokenFile: { type: 'string' },
            nodeId: { type: 'string' },
            pencilFile: { type: 'string' },
            pencilFrame: { type: 'string' },
            pencilTheme: { type: 'string' },
          },
          description: 'Design source parameters',
        },
        buildUrl: {
          type: 'string',
          description: 'URL of the built implementation',
        },
        viewport: {
          oneOf: [
            { type: 'string', enum: ['mobile-sm', 'mobile', 'tablet', 'desktop-sm', 'desktop', 'desktop-lg'] },
            {
              type: 'object',
              properties: {
                width: { type: 'number' },
                height: { type: 'number' },
                deviceScaleFactor: { type: 'number' },
              },
              required: ['width', 'height'],
            },
          ],
          description: 'Viewport preset name or custom viewport object',
        },
        selector: {
          type: 'string',
          description: 'CSS selector to target specific element',
        },
        threshold: {
          type: 'number',
          description: 'Match threshold (0-1, default 0.95)',
          minimum: 0,
          maximum: 1,
        },
      },
      required: ['designSource', 'buildUrl'],
    },
  },
  {
    name: 'get_visual_diff',
    description: 'Generate visual diff overlay between two images',
    inputSchema: {
      type: 'object',
      properties: {
        designImage: {
          type: 'string',
          description: 'Design image as base64 string or file path',
        },
        buildImage: {
          type: 'string',
          description: 'Build image as base64 string or file path',
        },
      },
      required: ['designImage', 'buildImage'],
    },
  },
  {
    name: 'get_design_tokens',
    description: 'Extract structured design tokens from Figma, token file, or Pencil.dev .pen file',
    inputSchema: {
      type: 'object',
      properties: {
        figmaUrl: {
          type: 'string',
          description: 'Full Figma file URL',
        },
        figmaFileKey: {
          type: 'string',
          description: 'Figma file key (alternative to full URL)',
        },
        tokenFile: {
          type: 'string',
          description: 'Path to local design token file',
        },
        pencilFile: {
          type: 'string',
          description: 'Path to Pencil.dev .pen design file',
        },
        pencilFrame: {
          type: 'string',
          description: 'Frame name/id to extract from .pen file',
        },
        pencilTheme: {
          type: 'string',
          description: 'Theme mode for .pen file (e.g., "Light", "Dark")',
        },
      },
    },
  },
  {
    name: 'compare_design_tokens',
    description: 'Compare two sets of design tokens and report breaking changes',
    inputSchema: {
      type: 'object',
      properties: {
        oldTokens: {
          type: 'string',
          description: 'Old design tokens as JSON string or file path',
        },
        newTokens: {
          type: 'string',
          description: 'New design tokens as JSON string or file path',
        },
      },
      required: ['oldTokens', 'newTokens'],
    },
  },
  {
    name: 'evaluate_with_vlm',
    description: 'Use Claude Vision to qualitatively assess design-build fidelity (requires ANTHROPIC_API_KEY)',
    inputSchema: {
      type: 'object',
      properties: {
        designImage: {
          type: 'string',
          description: 'Design image as base64 string or file path',
        },
        buildImage: {
          type: 'string',
          description: 'Build image as base64 string or file path',
        },
        prompt: {
          type: 'string',
          description: 'Optional custom prompt for the VLM evaluation',
        },
      },
      required: ['designImage', 'buildImage'],
    },
  },
];

// ── MCP Server ──

class MCPServer {
  private engine: ComparisonEngine | null = null;
  private screenshotEngine: ScreenshotEngine | null = null;
  private designParser: DesignParser | null = null;
  private pixelComparator: PixelComparator | null = null;

  private getEngine(): ComparisonEngine {
    if (!this.engine) {
      this.engine = new ComparisonEngine();
    }
    return this.engine;
  }

  private getScreenshotEngine(): ScreenshotEngine {
    if (!this.screenshotEngine) {
      this.screenshotEngine = new ScreenshotEngine();
    }
    return this.screenshotEngine;
  }

  private getDesignParser(): DesignParser {
    if (!this.designParser) {
      this.designParser = new DesignParser();
    }
    return this.designParser;
  }

  private getPixelComparator(): PixelComparator {
    if (!this.pixelComparator) {
      this.pixelComparator = new PixelComparator();
    }
    return this.pixelComparator;
  }

  private resolveViewport(viewport?: string | Viewport): Viewport | undefined {
    if (!viewport) return undefined;
    if (typeof viewport === 'string') {
      return STANDARD_VIEWPORTS[viewport];
    }
    return viewport;
  }

  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { id, method, params } = request;

    // Validate JSON-RPC version
    if (request.jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        error: {
          code: ErrorCode.InvalidRequest,
          message: 'Invalid JSON-RPC version',
        },
      };
    }

    // Handle notifications (no id = no response expected)
    if (id === undefined) {
      // notifications/initialized, etc. — acknowledge silently
      return null as unknown as JsonRpcResponse;
    }

    try {
      let result: unknown;

      switch (method) {
        case 'ping':
          result = {};
          break;

        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'saccadic-ai-mcp',
              version: '0.1.0',
            },
          };
          break;

        case 'tools/list':
          result = { tools: TOOLS };
          break;

        case 'tools/call':
          result = await this.handleToolCall(params as { name: string; arguments?: unknown });
          break;

        default:
          throw {
            code: ErrorCode.MethodNotFound,
            message: `Method not found: ${method}`,
          };
      }

      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result,
      };
    } catch (error) {
      const isJsonRpcError = error && typeof error === 'object' && 'code' in error;

      return {
        jsonrpc: '2.0',
        id: id ?? null,
        error: isJsonRpcError
          ? (error as JsonRpcError)
          : {
              code: ErrorCode.InternalError,
              message: error instanceof Error ? error.message : String(error),
            },
      };
    }
  }

  private async handleToolCall(params: { name: string; arguments?: unknown }): Promise<unknown> {
    const { name, arguments: args } = params;

    switch (name) {
      case 'capture_screenshot':
        return await this.captureScreenshot(args as CaptureScreenshotParams);

      case 'load_design':
        return await this.loadDesign(args as LoadDesignParams);

      case 'compare_design_build':
        return await this.compareDesignBuild(args as CompareDesignBuildParams);

      case 'get_visual_diff':
        return await this.getVisualDiff(args as GetVisualDiffParams);

      case 'get_design_tokens':
        return await this.getDesignTokens(args as GetDesignTokensParams);

      case 'compare_design_tokens':
        return await this.compareDesignTokens(args as CompareDesignTokensParams);

      case 'evaluate_with_vlm':
        return await this.evaluateWithVLM(args as EvaluateWithVLMParams);

      default:
        throw {
          code: ErrorCode.MethodNotFound,
          message: `Unknown tool: ${name}`,
        };
    }
  }

  // ── Tool Handlers ──

  private async captureScreenshot(params: CaptureScreenshotParams) {
    const screenshotEngine = this.getScreenshotEngine();
    const viewport = this.resolveViewport(params.viewport);

    const result = await screenshotEngine.capture({
      url: params.url,
      viewport,
      selector: params.selector,
      fullPage: params.fullPage,
    });

    const base64Image = result.image.toString('base64');

    // Write to disk if outputPath is provided
    let filePath: string | undefined;
    if (params.outputPath) {
      const fs = await import('fs/promises');
      const path = await import('path');
      const resolved = path.resolve(params.outputPath);
      await fs.writeFile(resolved, result.image);
      filePath = resolved;
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              viewport: result.viewport,
              url: result.url,
              selector: result.selector,
              timestamp: result.timestamp,
              domElementCount: result.domStyles?.length || 0,
              ...(filePath ? { filePath } : {}),
            },
            null,
            2
          ),
        },
        {
          type: 'image',
          data: base64Image,
          mimeType: 'image/png',
        },
      ],
    };
  }

  private async loadDesign(params: LoadDesignParams) {
    const designParser = this.getDesignParser();

    let design;
    if (params.figmaUrl) {
      // Extract file key from Figma URL
      const fileKeyMatch = params.figmaUrl.match(/file\/([a-zA-Z0-9]+)/);
      if (!fileKeyMatch) {
        throw {
          code: ErrorCode.InvalidParams,
          message: 'Invalid Figma URL format',
        };
      }
      const fileKey = fileKeyMatch[1];
      design = await designParser.parseFromFigma(fileKey, params.nodeId);
    } else if (params.figmaFileKey) {
      design = await designParser.parseFromFigma(params.figmaFileKey, params.nodeId);
    } else if (params.pencilFile) {
      const fs = await import('fs/promises');
      const content = await fs.readFile(params.pencilFile, 'utf-8');
      const parser = new PencilParser();
      design = parser.parse(JSON.parse(content), {
        frameName: params.pencilFrame,
        themeMode: params.pencilTheme,
      });
    } else if (params.tokenFile) {
      // For token file, we can't get full design state, only tokens
      const tokens = await designParser.parseFromTokenFile(params.tokenFile);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                type: 'tokens',
                colorCount: Object.keys(tokens.colors).length,
                spacingCount: Object.keys(tokens.spacing).length,
                typographyCount: Object.keys(tokens.typography).length,
                tokens,
              },
              null,
              2
            ),
          },
        ],
      };
    } else {
      throw {
        code: ErrorCode.InvalidParams,
        message: 'Must provide figmaUrl, figmaFileKey, pencilFile, or tokenFile',
      };
    }

    // Flatten design nodes to extract all IDs for data-pen-id annotation
    const flattenNodeIds = (nodes: typeof design.nodes): string[] => {
      const ids: string[] = [];
      for (const node of nodes) {
        ids.push(node.id);
        if (node.children?.length) {
          ids.push(...flattenNodeIds(node.children));
        }
      }
      return ids;
    };
    const nodeIds = flattenNodeIds(design.nodes);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              id: design.id,
              name: design.name,
              viewport: design.viewport,
              nodeCount: design.nodes.length,
              hasTokens: !!design.tokens,
              nodeIds,
              instructions: 'Add data-pen-id="{nodeId}" to each corresponding HTML element for accurate comparison. For example: <div data-pen-id="navHome">',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  private async compareDesignBuild(params: CompareDesignBuildParams) {
    const engine = this.getEngine();
    await engine.init();

    const viewport = this.resolveViewport(params.viewport);

    // Extract Figma file key from URL if provided
    let figmaFileKey = params.designSource.figmaFileKey;
    if (!figmaFileKey && params.designSource.figmaUrl) {
      const fileKeyMatch = params.designSource.figmaUrl.match(/file\/([a-zA-Z0-9]+)/);
      if (fileKeyMatch) {
        figmaFileKey = fileKeyMatch[1];
      }
    }

    const result = await engine.compare({
      designSource: {
        figmaFileKey,
        figmaNodeId: params.designSource.nodeId,
        tokenFile: params.designSource.tokenFile,
        pencilFile: params.designSource.pencilFile,
        pencilFrame: params.designSource.pencilFrame,
        pencilTheme: params.designSource.pencilTheme,
        referenceImage: undefined,
      },
      buildUrl: params.buildUrl,
      viewport,
      selector: params.selector,
      threshold: params.threshold,
    });

    const content = [
      {
        type: 'text',
        text: JSON.stringify(
          {
            overall: result.overall,
            domDiff: {
              matches: result.domDiff.matches,
              mismatchCount: result.domDiff.mismatches.length,
              missingCount: result.domDiff.missing.length,
              extraCount: result.domDiff.extra.length,
            },
            pixelDiff: {
              totalPixels: result.pixelDiff.totalPixels,
              diffPixels: result.pixelDiff.diffPixels,
              diffPercentage: result.pixelDiff.diffPercentage,
              pixelComparisonRan: result.pixelDiff.pixelComparisonRan,
            },
            regionCount: result.regions.length,
            feedback: result.feedback,
            timestamp: result.timestamp,
          },
          null,
          2
        ),
      },
    ];

    // Add diff image if available
    if (result.pixelDiff.diffImage) {
      content.push({
        type: 'image',
        data: result.pixelDiff.diffImage.toString('base64'),
        mimeType: 'image/png',
      } as any);
    }

    return { content };
  }

  private async getVisualDiff(params: GetVisualDiffParams) {
    const pixelComparator = this.getPixelComparator();

    // Load images (support base64 or file paths)
    const loadImage = async (imageData: string): Promise<Buffer> => {
      if (imageData.startsWith('data:image')) {
        // Base64 data URI
        const base64Data = imageData.split(',')[1];
        return Buffer.from(base64Data, 'base64');
      } else if (imageData.startsWith('/') || imageData.match(/^[A-Za-z]:\\/)) {
        // File path — validate against path traversal
        const path = await import('path');
        const resolved = path.resolve(imageData);
        if (resolved !== path.normalize(imageData)) {
          throw { code: ErrorCode.InvalidParams, message: 'Path traversal detected' };
        }
        const fs = await import('fs/promises');
        return fs.readFile(resolved);
      } else {
        // Assume it's raw base64
        return Buffer.from(imageData, 'base64');
      }
    };

    const designImage = await loadImage(params.designImage);
    const buildImage = await loadImage(params.buildImage);

    const result = pixelComparator.compare(designImage, buildImage);

    const content: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: JSON.stringify(
          {
            totalPixels: result.totalPixels,
            diffPixels: result.diffPixels,
            diffPercentage: result.diffPercentage,
          },
          null,
          2
        ),
      },
    ];

    if (result.diffImage) {
      content.push({
        type: 'image',
        data: result.diffImage.toString('base64'),
        mimeType: 'image/png',
      });
    }

    return { content };
  }

  private async getDesignTokens(params: GetDesignTokensParams) {
    const designParser = this.getDesignParser();

    let tokens;
    if (params.pencilFile) {
      const fs = await import('fs/promises');
      const content = await fs.readFile(params.pencilFile, 'utf-8');
      const parser = new PencilParser();
      tokens = parser.extractTokensFromFile(JSON.parse(content), params.pencilTheme);
      if (!tokens) {
        tokens = { colors: {}, spacing: {}, typography: {}, shadows: {}, borders: {}, radii: {} };
      }
    } else if (params.tokenFile) {
      tokens = await designParser.parseFromTokenFile(params.tokenFile);
    } else if (params.figmaUrl) {
      const fileKeyMatch = params.figmaUrl.match(/file\/([a-zA-Z0-9]+)/);
      if (!fileKeyMatch) {
        throw {
          code: ErrorCode.InvalidParams,
          message: 'Invalid Figma URL format',
        };
      }
      tokens = await designParser.extractTokensFromFigma(fileKeyMatch[1]);
    } else if (params.figmaFileKey) {
      tokens = await designParser.extractTokensFromFigma(params.figmaFileKey);
    } else {
      throw {
        code: ErrorCode.InvalidParams,
        message: 'Must provide figmaUrl, figmaFileKey, pencilFile, or tokenFile',
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(tokens, null, 2),
        },
      ],
    };
  }

  private async compareDesignTokens(params: CompareDesignTokensParams) {
    const loadTokens = async (input: string): Promise<DesignTokens> => {
      // Try parsing as JSON first
      try {
        return JSON.parse(input) as DesignTokens;
      } catch {
        // Treat as file path
        const fs = await import('fs/promises');
        const content = await fs.readFile(input, 'utf-8');
        return JSON.parse(content) as DesignTokens;
      }
    };

    const oldTokens = await loadTokens(params.oldTokens);
    const newTokens = await loadTokens(params.newTokens);
    const versioning = new TokenVersioning();
    const diff = versioning.diff(oldTokens, newTokens);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(diff, null, 2),
        },
      ],
    };
  }

  private async evaluateWithVLM(params: EvaluateWithVLMParams) {
    const vlm = new VLMComparator();
    if (!vlm.isAvailable()) {
      throw {
        code: ErrorCode.InternalError,
        message:
          'VLM evaluation requires ANTHROPIC_API_KEY. ' +
          'Set it in your MCP server config env block: { "env": { "ANTHROPIC_API_KEY": "sk-ant-..." } } ' +
          'or export it in your shell: export ANTHROPIC_API_KEY=sk-ant-...',
      };
    }

    const loadImage = async (imageData: string): Promise<Buffer> => {
      if (imageData.startsWith('data:image')) {
        const base64Data = imageData.split(',')[1];
        return Buffer.from(base64Data, 'base64');
      } else if (imageData.startsWith('/') || imageData.match(/^[A-Za-z]:\\/)) {
        const path = await import('path');
        const resolved = path.resolve(imageData);
        if (resolved !== path.normalize(imageData)) {
          throw { code: ErrorCode.InvalidParams, message: 'Path traversal detected' };
        }
        const fs = await import('fs/promises');
        return fs.readFile(resolved);
      } else {
        return Buffer.from(imageData, 'base64');
      }
    };

    const designImage = await loadImage(params.designImage);
    const buildImage = await loadImage(params.buildImage);

    const evaluation = await vlm.compare({
      designImage,
      buildImage,
      prompt: params.prompt,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(evaluation, null, 2),
        },
      ],
    };
  }

  async cleanup() {
    if (this.screenshotEngine) {
      await this.screenshotEngine.close();
    }
    if (this.engine) {
      await this.engine.close();
    }
  }

  start() {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on('line', async (line: string) => {
      try {
        const request = JSON.parse(line) as JsonRpcRequest;

        // Validate JSON-RPC 2.0 format
        if (request.jsonrpc !== '2.0') {
          const response: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: null,
            error: {
              code: ErrorCode.InvalidRequest,
              message: 'Invalid JSON-RPC version',
            },
          };
          console.log(JSON.stringify(response));
          return;
        }

        const response = await this.handleRequest(request);
        if (response) {
          console.log(JSON.stringify(response));
        }
      } catch (error) {
        const response: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: ErrorCode.ParseError,
            message: error instanceof Error ? error.message : 'Parse error',
          },
        };
        console.log(JSON.stringify(response));
      }
    });

    rl.on('close', async () => {
      await this.cleanup();
      process.exit(0);
    });

    // Handle termination signals
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }
}

// ── Entry Point ──

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new MCPServer();
  server.start();
}

export { MCPServer };
