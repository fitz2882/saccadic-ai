/**
 * Comparison Engine
 *
 * Central orchestrator for visual comparison across all tiers:
 * 1. Design parsing (Figma/tokens)
 * 2. Build screenshot + DOM extraction
 * 3. DOM property comparison
 * 4. Pixel-level comparison
 * 5. Feedback generation
 */

import { ScreenshotEngine } from './screenshot-engine.js';
import { DesignParser } from './design-parser.js';
import { PixelComparator } from './pixel-comparator.js';
import { DOMComparator } from './dom-comparator.js';
import { FeedbackGenerator } from './feedback-generator.js';
import { SSIMComparator } from './ssim-comparator.js';
import { VLMComparator } from './vlm-comparator.js';
import { PencilParser } from './pencil-parser.js';
import { DesignRenderer } from './design-renderer.js';
import type {
  ComparisonResult,
  OverallScore,
  Viewport,
  DesignState,
  ScreenshotResult,
  DOMDiffResult,
  PixelDiffResult,
  DiffRegion,
  MLMetrics,
  VLMEvaluation,
} from './types.js';

export interface CompareOptions {
  designSource: {
    figmaFileKey?: string;
    figmaNodeId?: string;
    tokenFile?: string;
    referenceImage?: string;
    designState?: DesignState;
    pencilFile?: string;
    pencilFrame?: string;
    pencilTheme?: string;
  };
  buildUrl: string;
  viewport?: Viewport;
  selector?: string;
  threshold?: number;
  enableSSIM?: boolean;
  enableVLM?: boolean;
}

export class ComparisonEngine {
  private screenshotEngine: ScreenshotEngine;
  private designParser: DesignParser;
  private pixelComparator: PixelComparator;
  private domComparator: DOMComparator;
  private feedbackGenerator: FeedbackGenerator;
  private ssimComparator: SSIMComparator;
  private vlmComparator: VLMComparator;

  constructor() {
    this.screenshotEngine = new ScreenshotEngine();
    this.designParser = new DesignParser();
    this.pixelComparator = new PixelComparator();
    this.domComparator = new DOMComparator();
    this.feedbackGenerator = new FeedbackGenerator();
    this.ssimComparator = new SSIMComparator();
    this.vlmComparator = new VLMComparator();
  }

  /**
   * Initialize the screenshot engine (launches browser).
   */
  async init(): Promise<void> {
    await this.screenshotEngine.init();
  }

  /**
   * Compare build against design and generate feedback.
   *
   * Orchestrates:
   * 1. Load design state (from Figma or cached)
   * 2. Capture build screenshot + DOM styles
   * 3. Run DOM property comparison (~50ms, fastest)
   * 4. Run pixel diff (~100ms)
   * 5. Aggregate results
   * 6. Generate feedback
   * 7. Compute overall score and grade
   */
  async compare(options: CompareOptions): Promise<ComparisonResult> {
    const startTime = Date.now();

    // 1. Load design state
    const designState = await this.loadDesignState(options.designSource);

    // 2. Capture build screenshot + DOM styles
    const screenshotResult = await this.screenshotEngine.capture({
      url: options.buildUrl,
      viewport: options.viewport || designState.viewport,
      selector: options.selector,
      disableAnimations: true,
    });

    // 3. Run DOM property comparison
    const domDiff = this.domComparator.compare(
      screenshotResult.domStyles || [],
      designState.nodes
    );

    // 4. Run pixel diff (need design reference image)
    let pixelDiff: PixelDiffResult;
    let regions: DiffRegion[] = [];

    let referenceBuffer: Buffer | null = null;

    if (options.designSource.referenceImage) {
      referenceBuffer = await this.loadReferenceImage(options.designSource.referenceImage);
    } else if (designState.nodes.length > 0) {
      // Auto-generate reference screenshot from design state
      try {
        const renderer = new DesignRenderer();
        const html = renderer.render(
          designState.nodes,
          designState.viewport.width,
          designState.viewport.height
        );
        const fs = await import('fs/promises');
        const path = await import('path');
        const os = await import('os');
        const tmpPath = path.join(os.tmpdir(), `saccadic-design-${Date.now()}.html`);
        await fs.writeFile(tmpPath, html, 'utf-8');
        const refScreenshot = await this.screenshotEngine.capture({
          url: `file://${tmpPath}`,
          viewport: options.viewport || designState.viewport,
          disableAnimations: true,
        });
        referenceBuffer = refScreenshot.image;
        await fs.unlink(tmpPath).catch(() => {});
      } catch {
        // Fall back to no pixel comparison if rendering fails
        referenceBuffer = null;
      }
    }

    if (referenceBuffer) {
      const pixelResult = this.pixelComparator.compare(
        referenceBuffer,
        screenshotResult.image,
        { threshold: options.threshold || 0.1 }
      );
      pixelDiff = pixelResult;
      if (pixelResult.diffImage && pixelResult.diffPixels > 0) {
        const { PNG } = await import('pngjs');
        const png = PNG.sync.read(pixelResult.diffImage);
        regions = this.pixelComparator.findDiffRegions(pixelResult.diffImage, png.width, png.height);
      }
    } else {
      pixelDiff = {
        totalPixels: 0,
        diffPixels: 0,
        diffPercentage: 0,
        pixelComparisonRan: false,
      };
    }

    // 5. SSIM (optional, requires reference image)
    let mlMetrics: MLMetrics | undefined;
    if (options.enableSSIM && referenceBuffer) {
      mlMetrics = this.ssimComparator.compare(referenceBuffer, screenshotResult.image);
    }

    // 6. VLM evaluation (optional, requires API key)
    let vlmEvaluation: VLMEvaluation | undefined;
    if (options.enableVLM && referenceBuffer && this.vlmComparator.isAvailable()) {
      vlmEvaluation = await this.vlmComparator.compare({
        designImage: referenceBuffer,
        buildImage: screenshotResult.image,
      });
    }

    // 7. Generate feedback
    const feedback = this.feedbackGenerator.generate(
      domDiff,
      pixelDiff,
      regions,
      screenshotResult.domStyles
    );

    // 8. Compute overall score
    const overall = this.computeOverallScore(domDiff, pixelDiff, regions);

    return {
      overall,
      domDiff,
      pixelDiff,
      regions,
      feedback,
      timestamp: startTime,
      mlMetrics,
      vlmEvaluation,
    };
  }

  /**
   * Run comparison across multiple viewports in parallel.
   */
  async compareMultiViewport(
    options: CompareOptions,
    viewports: Viewport[],
    concurrency = 3
  ): Promise<Map<string, ComparisonResult>> {
    const results: Array<readonly [string, ComparisonResult]> = [];

    // Process viewports with concurrency limit to avoid browser resource contention
    for (let i = 0; i < viewports.length; i += concurrency) {
      const batch = viewports.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(async (viewport) => {
          const result = await this.compare({ ...options, viewport });
          const key = `${viewport.width}x${viewport.height}`;
          return [key, result] as const;
        })
      );
      results.push(...batchResults);
    }

    return new Map(results);
  }

  /**
   * Compute overall match score and grade.
   *
   * Grade scale:
   * - A: >95% match
   * - B: >85% match
   * - C: >70% match
   * - D: >50% match
   * - F: <50% match
   */
  private computeOverallScore(
    domDiff: DOMDiffResult,
    pixelDiff: PixelDiffResult,
    regions: DiffRegion[]
  ): OverallScore {
    // Weight DOM comparison heavily (it's more precise)
    // Include missing elements in total count (they are elements that should exist)
    const domTotal = domDiff.matches + domDiff.mismatches.length + domDiff.missing.length;
    const domMatchRate = domTotal > 0 ? domDiff.matches / domTotal : 1;

    // Pixel diff is secondary (can have false positives)
    // diffPercentage is 0-100, convert to 0-1 fraction
    const pixelMatchRate = 1 - (pixelDiff.diffPercentage / 100);

    // Count severe issues (fail severity)
    const failCount = domDiff.mismatches.filter((m) => m.severity === 'fail').length +
      regions.filter((r) => r.severity === 'fail').length +
      domDiff.missing.length; // Missing elements count as failures

    const warnCount = domDiff.mismatches.filter((m) => m.severity === 'warn').length +
      regions.filter((r) => r.severity === 'warn').length;

    // When pixel comparison didn't run, use DOM-only score to avoid
    // inflating the result with a phantom 30% perfect pixel score
    const matchPercentage = pixelDiff.pixelComparisonRan
      ? domMatchRate * 0.7 + pixelMatchRate * 0.3
      : domMatchRate;

    // Grade based on match percentage
    // Apply severity penalties: each 'fail' mismatch reduces score
    const failPenalty = failCount * 0.05; // 5% penalty per fail
    const warnPenalty = warnCount * 0.02; // 2% penalty per warn
    const adjustedMatchPercentage = Math.max(0, matchPercentage - failPenalty - warnPenalty);

    // Grade based on adjusted match percentage
    let grade: 'A' | 'B' | 'C' | 'D' | 'F';
    if (adjustedMatchPercentage > 0.95) {
      grade = 'A';
    } else if (adjustedMatchPercentage > 0.85) {
      grade = 'B';
    } else if (adjustedMatchPercentage > 0.7) {
      grade = 'C';
    } else if (adjustedMatchPercentage > 0.5) {
      grade = 'D';
    } else {
      grade = 'F';
    }

    const summary = this.feedbackGenerator.generateSummary({
      overall: {
        matchPercentage: adjustedMatchPercentage,
        grade,
        summary: '', // Will be filled in
      },
      domDiff,
      pixelDiff,
      regions,
      feedback: [],
      timestamp: Date.now(),
    });

    return {
      matchPercentage: adjustedMatchPercentage,
      grade,
      summary,
    };
  }

  /**
   * Load design state from various sources.
   */
  private async loadDesignState(source: CompareOptions['designSource']): Promise<DesignState> {
    if (source.designState) {
      return source.designState;
    } else if (source.pencilFile) {
      const fs = await import('fs/promises');
      const content = await fs.readFile(source.pencilFile, 'utf-8');
      const parser = new PencilParser();
      return parser.parse(JSON.parse(content), {
        frameName: source.pencilFrame,
        themeMode: source.pencilTheme,
      });
    } else if (source.figmaFileKey) {
      // Load from Figma API
      return this.designParser.parseFromFigma(
        source.figmaFileKey,
        source.figmaNodeId
      );
    } else if (source.tokenFile) {
      // Load from design tokens file
      // parseFromTokenFile returns DesignTokens, wrap in a DesignState
      const tokens = await this.designParser.parseFromTokenFile(source.tokenFile);
      return {
        id: 'tokens',
        name: source.tokenFile,
        viewport: { width: 1280, height: 800 },
        nodes: [],
        tokens,
      };
    } else {
      // Default empty state
      return {
        id: 'default',
        name: 'Default',
        viewport: { width: 1280, height: 800 },
        nodes: [],
      };
    }
  }

  /**
   * Load reference image from file path or URL.
   */
  private async loadReferenceImage(path: string): Promise<Buffer> {
    // If path is URL, fetch it
    if (path.startsWith('http://') || path.startsWith('https://')) {
      const response = await fetch(path);
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    // Otherwise read from file system
    const fs = await import('fs/promises');
    return fs.readFile(path);
  }

  /**
   * Cleanup resources.
   */
  async close(): Promise<void> {
    await this.screenshotEngine.close();
  }
}
