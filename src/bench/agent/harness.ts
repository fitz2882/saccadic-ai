/**
 * A/B test harness — orchestrates control vs treatment agent trials.
 */

import { ScreenshotEngine } from '../../core/screenshot-engine.js';
import { ComparisonEngine } from '../../core/comparison-engine.js';
import { AgentRunner, controlPrompt, treatmentPrompt } from './runner.js';
import { CostTracker } from '../cost/tracker.js';
import type { TestFixture, AgentTrialConfig, AgentTrialResult, AgentIteration, ABTestReport } from '../types.js';
import { MODEL_PRICING } from '../types.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface HarnessOptions {
  model?: string;
  maxIterations?: number;
}

export class ABTestHarness {
  private screenshotEngine: ScreenshotEngine;
  private comparisonEngine: ComparisonEngine;
  private runner: AgentRunner;
  private costTracker: CostTracker;
  private maxIterations: number;
  private model: string;

  constructor(options: HarnessOptions = {}) {
    this.model = options.model ?? 'claude-sonnet-4-20250514';
    this.maxIterations = options.maxIterations ?? 5;
    this.screenshotEngine = new ScreenshotEngine();
    this.comparisonEngine = new ComparisonEngine();
    this.runner = new AgentRunner(this.model);
    this.costTracker = new CostTracker();
  }

  async init(): Promise<void> {
    await this.screenshotEngine.init();
    await this.comparisonEngine.init();
  }

  async close(): Promise<void> {
    await this.screenshotEngine.close();
    await this.comparisonEngine.close();
  }

  /**
   * Run a single trial (control or treatment).
   */
  async runTrial(fixture: TestFixture, config: AgentTrialConfig): Promise<AgentTrialResult> {
    const startTime = Date.now();
    const iterations: AgentIteration[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let currentHtml: string | undefined;
    let converged = false;
    let finalGrade = 'F';
    let finalMatchPercentage = 0;

    // Capture design reference image
    const designDataUrl = `data:text/html,${encodeURIComponent(fixture.designHtml)}`;
    const designScreenshot = await this.screenshotEngine.capture({
      url: designDataUrl,
      viewport: fixture.designState.viewport,
      disableAnimations: true,
    });

    const tmpDir = join(process.cwd(), 'bench-results', '.tmp');
    await mkdir(tmpDir, { recursive: true });
    const refImagePath = join(tmpDir, `ref-trial-${fixture.id}-${config.withFeedback ? 'treat' : 'ctrl'}.png`);
    await writeFile(refImagePath, designScreenshot.image);

    for (let i = 0; i < config.maxIterations; i++) {
      // Build prompt
      let prompt: string;
      if (config.withFeedback && currentHtml && iterations.length > 0) {
        // Treatment: get Saccadic AI feedback on current HTML
        const buildUrl = `data:text/html,${encodeURIComponent(currentHtml)}`;
        const comparison = await this.comparisonEngine.compare({
          designSource: { referenceImage: refImagePath },
          buildUrl,
          viewport: fixture.designState.viewport,
        });
        prompt = treatmentPrompt(config.designDescription, comparison.feedback, currentHtml);
      } else if (currentHtml) {
        // Control: just generic "improve" prompt
        prompt = controlPrompt(config.designDescription, currentHtml);
      } else {
        // Initial: design description only
        prompt = controlPrompt(config.designDescription);
      }

      // Generate HTML
      const result = await this.costTracker.track(
        `trial-${fixture.id}-${config.withFeedback ? 'treat' : 'ctrl'}-iter${i}`,
        () => this.runner.generateHtml(prompt),
      );

      currentHtml = result.html;
      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;

      this.costTracker.recordAgentTokens(result.inputTokens, result.outputTokens, this.model);

      // Score the generated HTML
      const buildUrl = `data:text/html,${encodeURIComponent(currentHtml)}`;
      const comparison = await this.comparisonEngine.compare({
        designSource: { referenceImage: refImagePath },
        buildUrl,
        viewport: fixture.designState.viewport,
      });

      const iteration: AgentIteration = {
        iteration: i,
        html: currentHtml,
        grade: comparison.overall.grade,
        matchPercentage: comparison.overall.matchPercentage,
        feedbackCount: comparison.feedback.filter((f) => f.severity !== 'pass').length,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      };
      iterations.push(iteration);

      finalGrade = comparison.overall.grade;
      finalMatchPercentage = comparison.overall.matchPercentage;

      if (comparison.overall.grade === 'A') {
        converged = true;
        break;
      }
    }

    // Compute USD cost
    const modelPricing = MODEL_PRICING[this.model] ?? { inputPer1M: 3, outputPer1M: 15 };
    const totalCostUsd =
      (totalInputTokens / 1_000_000) * modelPricing.inputPer1M +
      (totalOutputTokens / 1_000_000) * modelPricing.outputPer1M;

    return {
      config,
      iterations,
      converged,
      finalGrade,
      finalMatchPercentage,
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Run A/B test across fixtures.
   */
  async runABTest(fixtures: TestFixture[]): Promise<ABTestReport> {
    const controlResults: AgentTrialResult[] = [];
    const treatmentResults: AgentTrialResult[] = [];

    for (const fixture of fixtures) {
      const designDescription = `An HTML page with the following structure:\n${fixture.designHtml}`;

      const baseConfig = {
        fixtureId: fixture.id,
        designDescription,
        maxIterations: this.maxIterations,
        model: this.model,
      };

      // Control trial
      const controlResult = await this.runTrial(fixture, { ...baseConfig, withFeedback: false });
      controlResults.push(controlResult);

      // Treatment trial
      const treatmentResult = await this.runTrial(fixture, { ...baseConfig, withFeedback: true });
      treatmentResults.push(treatmentResult);
    }

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const summary = {
      controlAvgIterations: avg(controlResults.map((r) => r.iterations.length)),
      treatmentAvgIterations: avg(treatmentResults.map((r) => r.iterations.length)),
      controlAvgScore: avg(controlResults.map((r) => r.finalMatchPercentage)),
      treatmentAvgScore: avg(treatmentResults.map((r) => r.finalMatchPercentage)),
      controlConvergenceRate: avg(controlResults.map((r) => r.converged ? 1 : 0)),
      treatmentConvergenceRate: avg(treatmentResults.map((r) => r.converged ? 1 : 0)),
      controlAvgCostUsd: avg(controlResults.map((r) => r.totalCostUsd)),
      treatmentAvgCostUsd: avg(treatmentResults.map((r) => r.totalCostUsd)),
    };

    return {
      fixtures: fixtures.map((f) => f.id),
      control: controlResults,
      treatment: treatmentResults,
      summary,
      cost: this.costTracker.getSummary(),
      timestamp: Date.now(),
    };
  }
}
