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
  RefineBuildParams,
  GetVisualDiffParams,
  GetDesignTokensParams,
  CompareDesignTokensParams,
  EvaluateWithVLMParams,
  PlanBuildParams,
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
    description: 'Run full comparison pipeline between design and build implementation. For best results: (1) add data-pen-id attributes to build elements matching design node IDs from load_design, (2) provide a referenceImage for accurate pixel comparison — use Pencil MCP get_screenshot for .pen designs, or set FIGMA_TOKEN for auto-fetching Figma renders.',
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
        referenceImage: {
          type: 'string',
          description: 'Design screenshot as base64 string, file path, or URL. For Pencil designs, use get_screenshot from the Pencil MCP. For Figma, this is auto-fetched from the Figma Images API if FIGMA_TOKEN is set. Without a reference image, pixel comparison uses an auto-generated approximation.',
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
  {
    name: 'refine_build',
    description:
      'Iterative build refinement tool with multi-page orchestration. Compares a build against a design and returns ' +
      'detailed mismatches with actionable fixes. Call repeatedly after applying fixes until status is "pass". ' +
      'Tracks iteration history per page, detects stalls, and auto-discovers all frames in .pen files. ' +
      'When a page passes (≥95%), returns the next page to work on. Target: 95% (Grade A).',
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
          description: 'Design source parameters. If pencilFile is provided without pencilFrame, all frames are auto-discovered.',
        },
        buildUrl: {
          type: 'string',
          description: 'URL of the built implementation',
        },
        referenceImage: {
          type: 'string',
          description: 'Design screenshot (base64 data URI, file path, or URL). Use Pencil MCP get_screenshot for .pen designs.',
        },
        targetScore: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Target match score (0-1) before status becomes "pass" (default: 0.95)',
        },
        targetGrade: {
          type: 'string',
          enum: ['A', 'B', 'C'],
          description: 'Target grade (default: A). Overridden by targetScore if both provided.',
        },
        viewport: {
          oneOf: [
            { type: 'string', enum: ['mobile-sm', 'mobile', 'tablet', 'desktop-sm', 'desktop', 'desktop-lg'] },
            {
              type: 'object',
              properties: {
                width: { type: 'number' },
                height: { type: 'number' },
              },
              required: ['width', 'height'],
            },
          ],
          description: 'Viewport preset or custom size',
        },
        selector: {
          type: 'string',
          description: 'CSS selector to target specific element',
        },
        iteration: {
          type: 'number',
          description: 'Current iteration number (for tracking progress). Start at 1.',
        },
        maxIterations: {
          type: 'number',
          description: 'Maximum iterations before forcing stop (default: 10)',
        },
      },
      required: ['designSource', 'buildUrl'],
    },
  },
  {
    name: 'plan_build',
    description:
      'Analyze a .pen design file and generate a complete build orchestration plan with per-page agent prompts. ' +
      'Returns everything needed to build all pages in parallel: design structure, tokens, node IDs, ' +
      'ready-to-use agent prompts, and an orchestration prompt for spawning parallel sub-agents.',
    inputSchema: {
      type: 'object',
      properties: {
        pencilFile: {
          type: 'string',
          description: 'Path to .pen design file',
        },
        pencilTheme: {
          type: 'string',
          description: 'Theme mode (e.g., "Light", "Dark")',
        },
        buildDir: {
          type: 'string',
          description: 'Build output directory (default: ./build)',
        },
        techStack: {
          type: 'string',
          enum: ['html', 'react', 'nextjs'],
          description: 'Tech stack for generated code (default: html)',
        },
        targetScore: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Target match score 0-1 (default: 0.95)',
        },
        maxIterationsPerPage: {
          type: 'number',
          description: 'Max refine iterations per page (default: 10)',
        },
      },
      required: ['pencilFile'],
    },
  },
];

// ── Refine Session State ──

interface RefinePageStatus {
  name: string;
  status: 'pending' | 'iterating' | 'passed';
  score: number;
  iterations: number;
}

interface RefineIterationRecord {
  iteration: number;
  score: number;
  grade: string;
  failCount: number;
  warnCount: number;
}

interface RefineDOMSnapshot {
  styleHashes: Map<string, string>;
  domStyles: Array<{ selector: string; bounds: { x: number; y: number; width: number; height: number } }>;
}

interface RefineSession {
  pencilFile: string;
  pages: RefinePageStatus[];
  currentFrame: string | null;
  history: RefineIterationRecord[];
  previousSnapshot?: RefineDOMSnapshot;
  changedElements?: Set<string>;
}

// ── MCP Server ──

class MCPServer {
  private engine: ComparisonEngine | null = null;
  private screenshotEngine: ScreenshotEngine | null = null;
  private designParser: DesignParser | null = null;
  private pixelComparator: PixelComparator | null = null;
  private refineSessions = new Map<string, RefineSession>();

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

      case 'refine_build':
        return await this.refineBuild(args as RefineBuildParams);

      case 'plan_build':
        return await this.planBuild(args as PlanBuildParams);

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
              instructions: 'Add data-pen-id="{nodeId}" to each corresponding HTML element for accurate comparison. For example: <div data-pen-id="navHome">. For pixel-accurate comparison, provide a referenceImage to compare_design_build — use Pencil MCP get_screenshot to capture the design frame as a PNG.',
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
    const tempFiles: string[] = [];

    // Extract Figma file key from URL if provided
    let figmaFileKey = params.designSource.figmaFileKey;
    if (!figmaFileKey && params.designSource.figmaUrl) {
      const fileKeyMatch = params.designSource.figmaUrl.match(/file\/([a-zA-Z0-9]+)/);
      if (fileKeyMatch) {
        figmaFileKey = fileKeyMatch[1];
      }
    }

    // Resolve reference image:
    // 1. Use explicitly provided referenceImage (data URI, file path, or URL)
    // 2. For Figma: auto-fetch from Figma Images API
    // 3. Fall back to auto-generated approximation in comparison-engine
    let referenceImage = params.referenceImage;

    if (!referenceImage && figmaFileKey && process.env.FIGMA_TOKEN) {
      try {
        const parser = new DesignParser();
        const imageBuffer = await parser.getFigmaScreenshot(
          figmaFileKey,
          params.designSource.nodeId
        );
        const fs = await import('fs/promises');
        const path = await import('path');
        const os = await import('os');
        const tmpPath = path.join(os.tmpdir(), `saccadic-figma-ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
        await fs.writeFile(tmpPath, imageBuffer);
        referenceImage = tmpPath;
        tempFiles.push(tmpPath);
      } catch (error) {
        process.stderr.write(`[saccadic] Figma screenshot auto-fetch failed: ${error instanceof Error ? error.message : error}\n`);
      }
    }

    // If referenceImage is a data URI, write to temp file
    if (referenceImage && referenceImage.startsWith('data:image')) {
      try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const os = await import('os');
        const tmpPath = path.join(os.tmpdir(), `saccadic-ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
        const base64Data = referenceImage.split(',')[1];
        await fs.writeFile(tmpPath, Buffer.from(base64Data, 'base64'));
        referenceImage = tmpPath;
        tempFiles.push(tmpPath);
      } catch (error) {
        process.stderr.write(`[saccadic] Base64 decode failed: ${error instanceof Error ? error.message : error}\n`);
        referenceImage = undefined;
      }
    }

    try {
    const result = await engine.compare({
      designSource: {
        figmaFileKey,
        figmaNodeId: params.designSource.nodeId,
        tokenFile: params.designSource.tokenFile,
        pencilFile: params.designSource.pencilFile,
        pencilFrame: params.designSource.pencilFrame,
        pencilTheme: params.designSource.pencilTheme,
        referenceImage,
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
    } finally {
      // Clean up temp files
      if (tempFiles.length > 0) {
        const fs = await import('fs/promises');
        await Promise.all(tempFiles.map(f => fs.unlink(f).catch(() => {})));
      }
    }
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

  /**
   * Get or create a refine session for a .pen file.
   */
  private async getOrCreateSession(pencilFile: string): Promise<RefineSession> {
    const existing = this.refineSessions.get(pencilFile);
    if (existing) return existing;

    // Discover frames from the .pen file
    const fs = await import('fs/promises');
    const content = await fs.readFile(pencilFile, 'utf-8');
    const parser = new PencilParser();
    const frames = parser.listFrames(JSON.parse(content));

    const session: RefineSession = {
      pencilFile,
      pages: frames.map(f => ({
        name: f.name,
        status: 'pending' as const,
        score: 0,
        iterations: 0,
      })),
      currentFrame: null,
      history: [],
    };

    this.refineSessions.set(pencilFile, session);
    return session;
  }

  private async refineBuild(params: RefineBuildParams) {
    // Resolve target score: targetScore takes precedence over targetGrade
    const gradeThresholds: Record<string, number> = { A: 0.95, B: 0.85, C: 0.7 };
    const targetScore = params.targetScore ?? gradeThresholds[params.targetGrade || 'A'] ?? 0.95;
    const iteration = params.iteration || 1;
    const maxIterations = params.maxIterations || 10;

    // Session management for .pen files
    let session: RefineSession | null = null;
    const pencilFile = params.designSource.pencilFile;
    const currentFrame = params.designSource.pencilFrame;

    if (pencilFile) {
      session = await this.getOrCreateSession(pencilFile);

      // If frame changed, clear iteration history
      if (currentFrame && currentFrame !== session.currentFrame) {
        session.history = [];
        session.currentFrame = currentFrame;

        // Mark the new frame as iterating
        const page = session.pages.find(p => p.name === currentFrame);
        if (page) page.status = 'iterating';
      }
    }

    // Run the actual comparison
    const compareResult = await this.compareDesignBuild({
      designSource: params.designSource,
      buildUrl: params.buildUrl,
      viewport: params.viewport,
      selector: params.selector,
      threshold: targetScore,
      referenceImage: params.referenceImage,
    });

    // Parse the comparison result
    const resultJson = JSON.parse(
      (compareResult.content[0] as { type: string; text: string }).text
    );

    const currentGrade = resultJson.overall.grade as string;
    const matchPercentage = resultJson.overall.matchPercentage as number;
    const matchPct = Math.round(matchPercentage * 100);

    // Extract full mismatch details from feedback
    const feedback = resultJson.feedback as Array<{
      severity: string;
      category: string;
      message: string;
      element?: string;
      fix?: string;
      property?: string;
      expected?: string;
      actual?: string;
    }>;

    const fails = feedback.filter(f => f.severity === 'fail');
    const warns = feedback.filter(f => f.severity === 'warn');

    // Track iteration in session
    if (session) {
      session.history.push({
        iteration,
        score: matchPercentage,
        grade: currentGrade,
        failCount: fails.length,
        warnCount: warns.length,
      });

      // Update page status
      if (currentFrame) {
        const page = session.pages.find(p => p.name === currentFrame);
        if (page) {
          page.score = matchPercentage;
          page.iterations = iteration;
        }
      }
    }

    // Stall detection: score hasn't improved in last 2 iterations
    let stalled = false;
    if (session && session.history.length >= 3) {
      const recent = session.history.slice(-3);
      const scoreImprovement = recent[recent.length - 1].score - recent[0].score;
      stalled = scoreImprovement < 0.01; // Less than 1% improvement over 3 iterations
    }

    // Determine status
    const meetsTarget = matchPercentage >= targetScore;
    const hitMaxIterations = iteration >= maxIterations;

    let status: 'pass' | 'iterate' | 'max_iterations';
    if (meetsTarget) {
      status = 'pass';
      // Mark page as passed in session
      if (session && currentFrame) {
        const page = session.pages.find(p => p.name === currentFrame);
        if (page) page.status = 'passed';
      }
    } else if (hitMaxIterations) {
      status = 'max_iterations';
    } else {
      status = 'iterate';
    }

    // Find next page if current passed
    let nextPage: { frame: string } | null = null;
    if (session && status === 'pass') {
      const pending = session.pages.find(p => p.status === 'pending');
      if (pending) {
        nextPage = { frame: pending.name };
      }
    }

    // Incremental comparison tracking (t-006): identify changed elements
    if (session) {
      // Build current snapshot
      const currentHashes = new Map<string, string>();
      for (const f of feedback) {
        if (f.element) {
          // Use message as a proxy hash for the element's comparison state
          const existing = currentHashes.get(f.element) || '';
          currentHashes.set(f.element, existing + '|' + f.severity + ':' + f.category);
        }
      }

      if (session.previousSnapshot) {
        // Identify what changed since last iteration
        const changed = new Set<string>();
        for (const [el, hash] of currentHashes) {
          const prevHash = session.previousSnapshot.styleHashes.get(el);
          if (prevHash !== hash) changed.add(el);
        }
        // Elements that were in previous but not in current (fixed)
        for (const [el] of session.previousSnapshot.styleHashes) {
          if (!currentHashes.has(el)) changed.add(el);
        }
        session.changedElements = changed;
      }

      session.previousSnapshot = {
        styleHashes: currentHashes,
        domStyles: [],
      };
    }

    // Build prioritized fix list with dependency ordering (t-009)
    const prioritizedFixes: Array<{ priority: number; element?: string; issue: string; fix?: string; subsumes?: string[] }> = [];
    let priority = 1;

    // Dependency graph: if a missing element contains other mismatched elements,
    // fixing the parent subsumes children
    const missingFixes = fails.filter(f => f.category === 'missing');
    const nonMissingFails = fails.filter(f => f.category !== 'missing' && f.category !== 'extra');

    // Build containment map from mismatch bounds
    const mismatchBounds = new Map<string, { x: number; y: number; width: number; height: number }>();
    // Parse bounds from messages when available (approximate from element names)
    for (const f of [...missingFixes, ...nonMissingFails, ...warns]) {
      if (f.element && !mismatchBounds.has(f.element)) {
        // Store a placeholder — actual containment uses element names heuristically
        mismatchBounds.set(f.element, { x: 0, y: 0, width: 0, height: 0 });
      }
    }

    // Add missing fixes first (highest priority)
    for (const f of missingFixes.slice(0, 3)) {
      // Check if adding this missing element would resolve child mismatches
      const elementName = f.element || f.message.replace('Missing element: ', '');
      const subsumed = nonMissingFails
        .filter(child => child.element && child.element.includes(elementName))
        .map(child => child.element!);

      prioritizedFixes.push({
        priority: priority++,
        element: f.element,
        issue: f.message,
        fix: subsumed.length > 0
          ? `${f.fix || f.message}. Adding this element may also resolve ${subsumed.length} child mismatch(es).`
          : f.fix,
        subsumes: subsumed.length > 0 ? subsumed : undefined,
      });
    }

    // Add visual fixes, skipping those subsumed by missing parent fixes
    const subsumedElements = new Set(prioritizedFixes.flatMap(f => f.subsumes || []));
    const visualFixes = nonMissingFails.filter(f => !f.element || !subsumedElements.has(f.element));
    for (const f of visualFixes.slice(0, 5)) {
      prioritizedFixes.push({ priority: priority++, element: f.element, issue: f.message, fix: f.fix });
    }
    for (const f of warns.slice(0, Math.max(0, 10 - prioritizedFixes.length))) {
      if (!f.element || !subsumedElements.has(f.element)) {
        prioritizedFixes.push({ priority: priority++, element: f.element, issue: f.message, fix: f.fix });
      }
    }

    // Score breakdown
    const domTotal = resultJson.domDiff.matches + resultJson.domDiff.missingCount;
    const domMatchRate = domTotal > 0 ? resultJson.domDiff.matches / domTotal : 1;

    const scoreBreakdown = {
      domMatchRate,
      pixelDiffPercentage: resultJson.pixelDiff.diffPercentage,
      pixelComparisonRan: resultJson.pixelDiff.pixelComparisonRan,
      failCount: fails.length,
      warnCount: warns.length,
      domMatches: resultJson.domDiff.matches,
      missingCount: resultJson.domDiff.missingCount,
      extraCount: resultJson.domDiff.extraCount,
      matchPercentage,
    };

    // Build full mismatch array for the agent
    const mismatches = feedback
      .filter(f => f.severity === 'fail' || f.severity === 'warn')
      .map(f => ({
        element: f.element,
        property: f.property,
        category: f.category,
        expected: f.expected,
        actual: f.actual,
        severity: f.severity,
        message: f.message,
        fix: f.fix,
      }));

    // Extract missing and extra from feedback
    const missing = feedback
      .filter(f => f.category === 'missing')
      .map(f => f.element || f.message);

    const extra = feedback
      .filter(f => f.category === 'extra')
      .map(f => f.element || f.message);

    // Category breakdown
    const issueBreakdown: Record<string, number> = {};
    for (const f of feedback) {
      issueBreakdown[f.category] = (issueBreakdown[f.category] || 0) + 1;
    }

    // Stall-breaking strategies (t-010): analyze remaining mismatch types when stalled
    let stallStrategy = '';
    if (stalled) {
      // Categorize remaining issues
      const remainingCategories: Record<string, number> = {};
      for (const f of [...fails, ...warns]) {
        remainingCategories[f.category] = (remainingCategories[f.category] || 0) + 1;
      }

      const totalRemaining = fails.length + warns.length;
      const pixelOnlyIssues = (remainingCategories['rendering'] || 0);
      const positionSizeIssues = (remainingCategories['layout'] || 0) + (remainingCategories['size'] || 0);
      const missingExtraIssues = (remainingCategories['missing'] || 0) + (remainingCategories['extra'] || 0);

      // Detect oscillation (score going up/down alternately)
      let oscillating = false;
      if (session && session.history.length >= 4) {
        const recent4 = session.history.slice(-4);
        const diffs = [];
        for (let i = 1; i < recent4.length; i++) {
          diffs.push(recent4[i].score - recent4[i - 1].score);
        }
        oscillating = diffs.length >= 3 && diffs.some(d => d > 0) && diffs.some(d => d < 0);
      }

      if (oscillating) {
        stallStrategy = 'Score is oscillating — recent changes may be conflicting. Revert the last change and try a different approach.';
      } else if (totalRemaining > 0 && pixelOnlyIssues / totalRemaining > 0.6) {
        stallStrategy = 'Mostly pixel-level differences with clean DOM — focus on visual polish: shadows, gradients, border anti-aliasing, font rendering.';
      } else if (totalRemaining > 0 && positionSizeIssues / totalRemaining > 0.6) {
        stallStrategy = 'Mostly position/size issues — check parent layout mode (flex vs grid vs block), container sizing, and overflow behavior.';
      } else if (totalRemaining > 0 && missingExtraIssues / totalRemaining > 0.5) {
        stallStrategy = 'Many missing/extra elements — the page structure may need rebuilding rather than CSS adjustments.';
      } else if (matchPercentage < 0.8) {
        stallStrategy = 'Score below 80% and stalled — consider using evaluate_with_vlm for qualitative VLM assessment to identify structural issues.';
      } else {
        stallStrategy = 'Score stalled — try broader structural changes instead of incremental CSS fixes.';
      }
    }

    // Build message
    let message: string;
    let recommendation: string;
    if (status === 'pass') {
      message = `Page "${currentFrame || 'default'}" passed! Score: ${matchPct}% (Grade ${currentGrade}).`;
      recommendation = nextPage
        ? `Move to next page: set pencilFrame="${nextPage.frame}" and call refine_build with iteration=1.`
        : 'All pages complete!';
    } else if (status === 'max_iterations') {
      message = `Reached max ${maxIterations} iterations. Best score: ${matchPct}% (Grade ${currentGrade}). Target was ${Math.round(targetScore * 100)}%.`;
      recommendation = stallStrategy || 'Review remaining mismatches below and apply fixes manually.';
    } else {
      message = `Iteration ${iteration}: ${matchPct}% (Grade ${currentGrade}), target ${Math.round(targetScore * 100)}%. Apply fixes below and call refine_build again with iteration=${iteration + 1}.`;
      recommendation = stalled
        ? stallStrategy
        : 'Apply the fixes below, then call refine_build again.';
    }

    // Pencil reference image hint (t-013)
    if (pencilFile && !params.referenceImage) {
      recommendation += ' Tip: For more accurate pixel comparison, provide a referenceImage captured via Pencil MCP get_screenshot.';
    }

    // Build response
    const response: Record<string, unknown> = {
      status,
      iteration,
      score: `${matchPct}%`,
      grade: currentGrade,
      targetScore: `${Math.round(targetScore * 100)}%`,
      stalled,
      message,
      recommendation,
      scoreBreakdown,
      mismatches,
      missing,
      extra,
      topFixes: prioritizedFixes,
      issueBreakdown,
    };

    // Add page progress if we have a session
    if (session) {
      response.pageProgress = session.pages.map(p => ({
        frame: p.name,
        status: p.status,
        score: `${Math.round(p.score * 100)}%`,
        iterations: p.iterations,
      }));
      if (nextPage) {
        response.nextPage = nextPage;
      }
    }

    // Add iteration history for progress tracking
    if (session && session.history.length > 0) {
      response.iterationHistory = session.history.map(h => ({
        iteration: h.iteration,
        score: `${Math.round(h.score * 100)}%`,
        grade: h.grade,
      }));
    }

    // Incremental comparison: show which elements changed since last iteration (t-006)
    if (session?.changedElements && session.changedElements.size > 0 && iteration > 1) {
      response.changedSinceLastIteration = Array.from(session.changedElements);
    }

    // Stall strategy detail (t-010)
    if (stalled && stallStrategy) {
      response.stallStrategy = stallStrategy;
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  private async planBuild(params: PlanBuildParams) {
    const fs = await import('fs/promises');
    const path = await import('path');

    const pencilFile = path.resolve(params.pencilFile);
    const buildDir = params.buildDir || './build';
    const techStack = params.techStack || 'html';
    const targetScore = params.targetScore ?? 0.95;
    const maxIterations = params.maxIterationsPerPage ?? 10;
    const targetPct = Math.round(targetScore * 100);

    // Read and parse the .pen file
    const content = await fs.readFile(pencilFile, 'utf-8');
    const penData = JSON.parse(content);
    const parser = new PencilParser();

    // Discover all frames
    const frames = parser.listFrames(penData);
    if (frames.length === 0) {
      throw {
        code: ErrorCode.InvalidParams,
        message: 'No named frames found in .pen file. The design must have at least one top-level frame.',
      };
    }

    // Extract global tokens
    const tokens = parser.extractTokensFromFile(penData, params.pencilTheme);

    // Group frames into responsive page groups (desktop + mobile = one page)
    const pageGroups = this.groupResponsiveFrames(frames);

    // Build per-page plans
    const pages = pageGroups.map(group => {
      const primary = group.desktop || group.frames[0];

      // Parse primary (desktop) frame's design state
      const designState = parser.parse(penData, {
        frameName: primary.name,
        themeMode: params.pencilTheme,
      });

      // Generate human-readable node tree for primary
      const nodeTree = parser.describeNodeTree(designState.nodes);
      const nodeIds = parser.flattenNodeIds(designState.nodes);

      // Parse mobile variant if present
      let mobileNodeTree: string | undefined;
      let mobileNodeIds: Array<{ id: string; name: string; type: string }> | undefined;
      let mobileViewport: { width: number; height: number } | undefined;
      let mobileFrameName: string | undefined;

      if (group.mobile) {
        const mobileState = parser.parse(penData, {
          frameName: group.mobile.name,
          themeMode: params.pencilTheme,
        });
        mobileNodeTree = parser.describeNodeTree(mobileState.nodes);
        mobileNodeIds = parser.flattenNodeIds(mobileState.nodes);
        mobileViewport = {
          width: group.mobile.width || mobileState.viewport.width,
          height: group.mobile.height || mobileState.viewport.height,
        };
        mobileFrameName = group.mobile.name;
      }

      // Determine file extension based on tech stack
      const ext = techStack === 'html' ? '.html' : techStack === 'react' ? '.tsx' : '.tsx';
      const safeName = group.pageName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();

      // Pre-fill refine params (for desktop/primary)
      const refineParams = {
        designSource: {
          pencilFile,
          pencilFrame: primary.name,
          ...(params.pencilTheme ? { pencilTheme: params.pencilTheme } : {}),
        },
        targetScore,
        maxIterations,
      };

      // Format tokens for the prompt
      const tokenSummary = this.formatTokenSummary(tokens);

      const primaryViewport = {
        width: primary.width || designState.viewport.width,
        height: primary.height || designState.viewport.height,
      };

      // Build the agent prompt
      const agentPrompt = this.buildAgentPrompt({
        frameName: group.pageName,
        width: primaryViewport.width,
        height: primaryViewport.height,
        nodeTree,
        nodeIds,
        tokenSummary,
        buildDir,
        techStack,
        ext,
        safeName,
        targetPct,
        refineParams,
        pencilFile,
        // Responsive variant
        mobileNodeTree,
        mobileNodeIds,
        mobileViewport,
        mobileFrameName,
        desktopFrameName: group.mobile ? primary.name : undefined,
      });

      return {
        frame: group.pageName,
        frameId: primary.id,
        viewport: primaryViewport,
        ...(mobileViewport ? { mobileViewport } : {}),
        ...(mobileFrameName ? {
          responsiveVariants: {
            desktop: primary.name,
            mobile: mobileFrameName,
          },
        } : {}),
        nodeCount: nodeIds.length + (mobileNodeIds?.length || 0),
        nodeIds: nodeIds.map(n => ({ id: n.id, name: n.name, type: n.type })),
        ...(mobileNodeIds ? { mobileNodeIds: mobileNodeIds.map(n => ({ id: n.id, name: n.name, type: n.type })) } : {}),
        nodeTree,
        ...(mobileNodeTree ? { mobileNodeTree } : {}),
        designTokens: tokens || undefined,
        agentPrompt,
        refineParams,
        ...(mobileFrameName ? {
          mobileRefineParams: {
            designSource: {
              pencilFile,
              pencilFrame: mobileFrameName,
              ...(params.pencilTheme ? { pencilTheme: params.pencilTheme } : {}),
            },
            targetScore,
            maxIterations,
            viewport: mobileViewport,
          },
        } : {}),
      };
    });

    // Build orchestration prompt
    const orchestrationPrompt = this.buildOrchestrationPrompt({
      projectName: penData.version || path.basename(pencilFile, '.pen'),
      pages: pages.map(p => ({
        frame: p.frame,
        viewport: p.viewport,
        nodeCount: p.nodeCount,
        mobileViewport: (p as any).mobileViewport,
        responsiveVariants: (p as any).responsiveVariants,
      })),
      targetPct,
      buildDir,
      techStack,
    });

    const response = {
      projectName: penData.version || path.basename(pencilFile, '.pen'),
      totalPages: pages.length,
      targetScore: `${targetPct}%`,
      buildDir,
      techStack,
      pages: pages.map(p => ({
        frame: p.frame,
        frameId: p.frameId,
        viewport: p.viewport,
        nodeCount: p.nodeCount,
        nodeIds: p.nodeIds,
        nodeTree: p.nodeTree,
        designTokens: p.designTokens,
        agentPrompt: p.agentPrompt,
        refineParams: p.refineParams,
      })),
      orchestrationPrompt,
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  /**
   * Group frames into responsive page groups.
   * Detects mobile/desktop pairs by name similarity and viewport width.
   * Mobile frames (width <= 500) are grouped with their desktop counterpart.
   */
  private groupResponsiveFrames(
    frames: Array<{ id: string; name: string; width: number; height: number }>
  ): Array<{
    pageName: string;
    desktop?: typeof frames[0];
    mobile?: typeof frames[0];
    frames: typeof frames;
  }> {
    const MOBILE_MAX_WIDTH = 500;
    const mobilePatterns = /\b(mobile|phone|sm|small|narrow|responsive)\b/i;

    // Separate into mobile and desktop candidates
    const mobileFrames: typeof frames = [];
    const desktopFrames: typeof frames = [];

    for (const frame of frames) {
      const isMobileByWidth = frame.width > 0 && frame.width <= MOBILE_MAX_WIDTH;
      const isMobileByName = mobilePatterns.test(frame.name);
      if (isMobileByWidth || isMobileByName) {
        mobileFrames.push(frame);
      } else {
        desktopFrames.push(frame);
      }
    }

    // Try to pair each mobile frame with a desktop frame by name similarity
    const pairedMobile = new Set<string>();
    const groups: Array<{
      pageName: string;
      desktop?: typeof frames[0];
      mobile?: typeof frames[0];
      frames: typeof frames;
    }> = [];

    for (const desktop of desktopFrames) {
      // Normalize desktop name for matching
      const desktopBase = desktop.name
        .replace(/\b(desktop|lg|large|wide|web)\b/gi, '')
        .replace(/[-_\s]+/g, ' ')
        .trim()
        .toLowerCase();

      // Find best matching mobile frame
      let bestMobile: typeof frames[0] | undefined;
      let bestScore = 0;

      for (const mobile of mobileFrames) {
        if (pairedMobile.has(mobile.id)) continue;

        const mobileBase = mobile.name
          .replace(mobilePatterns, '')
          .replace(/[-_\s]+/g, ' ')
          .trim()
          .toLowerCase();

        // Check for substring match or high similarity
        if (desktopBase === mobileBase ||
            desktopBase.includes(mobileBase) ||
            mobileBase.includes(desktopBase)) {
          const score = 1;
          if (score > bestScore) {
            bestScore = score;
            bestMobile = mobile;
          }
        }
      }

      if (bestMobile) {
        pairedMobile.add(bestMobile.id);
        groups.push({
          pageName: desktop.name,
          desktop,
          mobile: bestMobile,
          frames: [desktop, bestMobile],
        });
      } else {
        groups.push({
          pageName: desktop.name,
          desktop,
          frames: [desktop],
        });
      }
    }

    // Any unpaired mobile frames become standalone pages
    for (const mobile of mobileFrames) {
      if (!pairedMobile.has(mobile.id)) {
        groups.push({
          pageName: mobile.name,
          frames: [mobile],
        });
      }
    }

    return groups;
  }

  private formatTokenSummary(tokens: import('../core/types.js').DesignTokens | undefined): string {
    if (!tokens) return 'No design tokens defined.';

    const sections: string[] = [];

    const colorEntries = Object.entries(tokens.colors);
    if (colorEntries.length > 0) {
      sections.push('Colors:\n' + colorEntries.map(([k, v]) => `  ${k}: ${v}`).join('\n'));
    }

    const spacingEntries = Object.entries(tokens.spacing);
    if (spacingEntries.length > 0) {
      sections.push('Spacing:\n' + spacingEntries.map(([k, v]) => `  ${k}: ${v}`).join('\n'));
    }

    const typoEntries = Object.entries(tokens.typography);
    if (typoEntries.length > 0) {
      sections.push('Typography:\n' + typoEntries.map(([k, v]) => `  ${k}: ${v.fontFamily} ${v.fontSize}/${v.lineHeight} (${v.fontWeight})`).join('\n'));
    }

    const radiiEntries = Object.entries(tokens.radii);
    if (radiiEntries.length > 0) {
      sections.push('Border Radii:\n' + radiiEntries.map(([k, v]) => `  ${k}: ${v}`).join('\n'));
    }

    return sections.length > 0 ? sections.join('\n\n') : 'No design tokens defined.';
  }

  private buildAgentPrompt(opts: {
    frameName: string;
    width: number;
    height: number;
    nodeTree: string;
    nodeIds: Array<{ id: string; name: string; type: string }>;
    tokenSummary: string;
    buildDir: string;
    techStack: string;
    ext: string;
    safeName: string;
    targetPct: number;
    refineParams: Record<string, unknown>;
    pencilFile: string;
    // Responsive variant (optional)
    mobileNodeTree?: string;
    mobileNodeIds?: Array<{ id: string; name: string; type: string }>;
    mobileViewport?: { width: number; height: number };
    mobileFrameName?: string;
    desktopFrameName?: string;
  }): string {
    const nodeIdList = opts.nodeIds
      .map(n => `  data-pen-id="${n.id}" → ${n.name} (${n.type})`)
      .join('\n');

    const isResponsive = !!(opts.mobileNodeTree && opts.mobileViewport);

    // Build responsive section if mobile variant exists
    let responsiveSection = '';
    if (isResponsive) {
      const mobileNodeIdList = opts.mobileNodeIds!
        .map(n => `  data-pen-id="${n.id}" → ${n.name} (${n.type})`)
        .join('\n');

      responsiveSection = `

## Mobile Design (${opts.mobileViewport!.width}×${opts.mobileViewport!.height})

IMPORTANT: The mobile layout is NOT a separate page. It is the responsive version of this same page.
Use CSS media queries (e.g., \`@media (max-width: ${opts.mobileViewport!.width}px)\`) to adapt the
layout, spacing, typography, and visibility for smaller screens.

### Mobile Design Structure
${opts.mobileNodeTree}

### Mobile Node IDs
${mobileNodeIdList}

### Responsive Implementation Rules
- Build ONE page file that works at both ${opts.width}px (desktop) and ${opts.mobileViewport!.width}px (mobile)
- Use \`@media (max-width: ${opts.mobileViewport!.width}px)\` for mobile-specific styles
- Desktop styles are the default; mobile styles override via media queries
- Elements that appear in both layouts should use the same data-pen-id
- Elements that only appear in mobile should be hidden by default and shown in the media query
- Elements that only appear in desktop should be visible by default and hidden in the media query
- Flex direction, gaps, padding, font sizes, and layout may all change between breakpoints`;
    }

    // Refine instructions differ for responsive pages
    let refineSteps: string;
    if (isResponsive) {
      refineSteps = `## Step 4: Iterate with refine_build (Desktop)
1. Call refine_build with:
   ${JSON.stringify(opts.refineParams, null, 2).split('\n').join('\n   ')}
   Set buildUrl to the URL serving your page (e.g., http://localhost:3000/${opts.safeName}${opts.ext})
   Set referenceImage to the path of the desktop screenshot you captured in Step 1
2. Read the mismatches and topFixes in the response
3. Apply the fixes to your code
4. Call refine_build again with iteration incremented
5. Repeat until status="pass" (score ≥ ${opts.targetPct}%)

## Step 5: Iterate with refine_build (Mobile)
After the desktop layout passes, verify the mobile layout:
1. Capture a mobile reference screenshot:
   \`\`\`
   get_screenshot({ pencilFile: "${opts.pencilFile}", nodeId: "${opts.mobileNodeIds?.[0]?.id || 'mobileFrameId'}" })
   \`\`\`
2. Call refine_build with:
   - designSource: { pencilFile: "${opts.pencilFile}", pencilFrame: "${opts.mobileFrameName}" }
   - viewport: { width: ${opts.mobileViewport!.width}, height: ${opts.mobileViewport!.height} }
   - buildUrl: same URL as desktop (the page should be responsive)
   - referenceImage: path to the mobile screenshot
   - iteration: 1
3. Apply mobile-specific fixes using media queries — do NOT break the desktop layout
4. Repeat until the mobile layout also passes (≥ ${opts.targetPct}%)
5. Re-verify desktop hasn't regressed after mobile fixes

## Step 6: Final Report
Report both desktop and mobile scores. Both must pass.`;
    } else {
      refineSteps = `## Step 4: Iterate with refine_build
1. Call refine_build with:
   ${JSON.stringify(opts.refineParams, null, 2).split('\n').join('\n   ')}
   Set buildUrl to the URL serving your page (e.g., http://localhost:3000/${opts.safeName}${opts.ext})
   Set referenceImage to the path of the screenshot you captured in Step 1
2. Read the mismatches and topFixes in the response
3. Apply the fixes to your code
4. Call refine_build again with iteration incremented
5. Repeat until status="pass" (score ≥ ${opts.targetPct}%)
6. When done, report your final score and any remaining issues`;
    }

    return `You are building a single ${isResponsive ? 'responsive ' : ''}page from a design specification.

## Design: ${opts.frameName}
${isResponsive ? `Desktop Viewport: ${opts.width}×${opts.height}\nMobile Viewport: ${opts.mobileViewport!.width}×${opts.mobileViewport!.height}` : `Viewport: ${opts.width}×${opts.height}`}

## ${isResponsive ? 'Desktop ' : ''}Design Structure
${opts.nodeTree}

## Design Tokens
${opts.tokenSummary}
${responsiveSection}

## Build Instructions
1. Create ${opts.buildDir}/${opts.safeName}${opts.ext}
2. Add data-pen-id="{nodeId}" to each HTML element matching design nodes
3. Match colors, spacing, typography, and layout exactly from the design structure above
4. Use semantic HTML${opts.techStack === 'html' ? ' with CSS (inline or <style> block)' : opts.techStack === 'react' ? ' with React components and CSS modules or styled-components' : ' with Next.js pages and CSS modules'}
${isResponsive
  ? `5. Build a SINGLE responsive page — desktop layout is the default, mobile layout uses @media (max-width: ${opts.mobileViewport!.width}px)
6. Do NOT create separate pages for desktop and mobile`
  : `5. Ensure the page renders at ${opts.width}×${opts.height} viewport`}

## ${isResponsive ? 'Desktop ' : ''}Node IDs (add as data-pen-id attributes)
${nodeIdList}

## Step 1: Capture Reference Screenshot${isResponsive ? 's' : ''}
Before building, capture ${isResponsive ? 'reference images for both viewports' : 'a pixel-perfect reference image of the design'}:
\`\`\`
get_screenshot({ pencilFile: "${opts.pencilFile}", nodeId: "${opts.nodeIds[0]?.id || 'frameId'}" })
\`\`\`
Save the returned screenshot to a file (e.g., ${opts.buildDir}/${opts.safeName}-ref.png).
${isResponsive ? `\nAlso capture the mobile reference:\n\`\`\`\nget_screenshot({ pencilFile: "${opts.pencilFile}", nodeId: "${opts.mobileNodeIds?.[0]?.id || 'mobileFrameId'}" })\n\`\`\`\nSave to ${opts.buildDir}/${opts.safeName}-mobile-ref.png.` : ''}

## Step 2: Build the Page
Create ${opts.buildDir}/${opts.safeName}${opts.ext} with all the design elements listed above.${isResponsive ? '\nBuild the desktop layout first, then add media queries for the mobile layout.' : ''}

## Step 3: Start Dev Server
Start a local dev server if one isn't already running:
\`\`\`
npx serve ${opts.buildDir}
\`\`\`

${refineSteps}

## Tips
- Focus on matching the design structure first (correct elements, hierarchy, data-pen-id), then refine visual properties (colors, spacing, typography)
${isResponsive ? '- Get the desktop layout passing first, then layer on mobile media queries\n- When fixing mobile issues, always re-check that desktop hasn\'t regressed\n- Use min-width or max-width media queries consistently — don\'t mix both' : ''}
- If stalled, read the stallStrategy in refine_build's response for guidance
- If score is below 80% and stalled, use evaluate_with_vlm for qualitative assessment (requires ANTHROPIC_API_KEY)

IMPORTANT: Focus only on this page. Do not modify other pages.`;
  }

  private buildOrchestrationPrompt(opts: {
    projectName: string;
    pages: Array<{
      frame: string;
      viewport: { width: number; height: number };
      nodeCount: number;
      mobileViewport?: { width: number; height: number };
      responsiveVariants?: { desktop: string; mobile: string };
    }>;
    targetPct: number;
    buildDir: string;
    techStack: string;
  }): string {
    const pageList = opts.pages
      .map((p, i) => {
        const responsive = p.mobileViewport
          ? ` (responsive: desktop ${p.viewport.width}×${p.viewport.height} + mobile ${p.mobileViewport.width}×${p.mobileViewport.height})`
          : ` — ${p.viewport.width}×${p.viewport.height}`;
        return `${i + 1}. "${p.frame}"${responsive}, ${p.nodeCount} design nodes`;
      })
      .join('\n');

    const hasResponsive = opts.pages.some(p => p.mobileViewport);

    return `## Saccadic Build Plan: ${opts.projectName}
${opts.pages.length} pages to build. Target: ${opts.targetPct}% match per page.
${hasResponsive ? `\nNote: Some pages have mobile variants. These are NOT separate pages — each is a single\nresponsive page built with CSS media queries. The sub-agent prompt handles this automatically.\n` : ''}
### Setup
1. Create the build directory: ${opts.buildDir}/
2. Set up a local dev server to serve the built files (e.g., npx serve ${opts.buildDir})
3. Each page is independent — build them in parallel

### Pages
${pageList}

### Execution Steps
For each page, spawn a sub-agent (via Task tool) with that page's agentPrompt from the plan.
Each sub-agent:
1. Captures reference screenshots via Pencil MCP get_screenshot (desktop${hasResponsive ? ' + mobile' : ''})
2. Builds the HTML/CSS for its page with data-pen-id attributes${hasResponsive ? '\n   - Responsive pages use media queries, NOT separate files' : ''}
3. Calls refine_build with the reference screenshot to check accuracy
4. Applies fixes from the topFixes in the response
5. Repeats until status="pass" (≥${opts.targetPct}%)${hasResponsive ? '\n6. For responsive pages: verifies both desktop AND mobile pass' : ''}

### Parallel Execution
Launch all ${opts.pages.length} sub-agents simultaneously. Each has a clean context
with only its page's design information — no cross-page context pollution.

### After All Pages Complete
1. Collect final scores from each sub-agent
2. Report per-page results${hasResponsive ? ' (desktop + mobile scores for responsive pages)' : ''}
3. If any page didn't reach ${opts.targetPct}%, review its remaining mismatches`;
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
