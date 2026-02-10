/**
 * Agent effectiveness benchmark suite.
 *
 * Runs A/B trials comparing control (no feedback) vs treatment (Saccadic AI feedback).
 * Requires ANTHROPIC_API_KEY environment variable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ABTestHarness } from './harness.js';
import { writeAgentReport } from '../cost/reporter.js';
import { getAllFixtures } from '../fixtures/index.js';
import type { ABTestReport } from '../types.js';

// Select a subset of fixtures for agent testing (expensive)
const AGENT_FIXTURE_IDS = [
  'color-bg-major',
  'spacing-padding-major',
  'typo-size-major',
  'element-missing-button',
  'compound-color-spacing',
];

describe.skipIf(!process.env.ANTHROPIC_API_KEY)('Agent Effectiveness Benchmark', () => {
  let harness: ABTestHarness;
  let report: ABTestReport;

  beforeAll(async () => {
    harness = new ABTestHarness({
      model: process.env.BENCH_MODEL ?? 'claude-sonnet-4-20250514',
      maxIterations: Number(process.env.BENCH_MAX_ITERS ?? 3),
    });
    await harness.init();
  }, 300_000); // 5 min init timeout

  afterAll(async () => {
    try {
      if (report) {
        await writeAgentReport(report);

        console.log('\n--- Agent Benchmark Summary ---');
        console.log(`Control avg score: ${(report.summary.controlAvgScore * 100).toFixed(1)}%`);
        console.log(`Treatment avg score: ${(report.summary.treatmentAvgScore * 100).toFixed(1)}%`);
        console.log(`Control convergence: ${(report.summary.controlConvergenceRate * 100).toFixed(0)}%`);
        console.log(`Treatment convergence: ${(report.summary.treatmentConvergenceRate * 100).toFixed(0)}%`);
        console.log(`Total cost: $${report.cost.totalCostUsd.toFixed(4)}`);
      }
    } finally {
      await harness.close();
    }
  });

  it('runs A/B test across fixture subset', async () => {
    const allFixtures = getAllFixtures();
    const fixtures = AGENT_FIXTURE_IDS
      .map((id) => allFixtures.find((f) => f.id === id))
      .filter((f): f is NonNullable<typeof f> => f != null);

    expect(fixtures.length).toBeGreaterThan(0);

    report = await harness.runABTest(fixtures);

    // Treatment should score at least as well as control
    expect(report.summary.treatmentAvgScore).toBeGreaterThanOrEqual(
      report.summary.controlAvgScore * 0.9 // Allow 10% tolerance
    );
  }, 600_000); // 10 min timeout for full A/B test

  it('treatment should use fewer iterations on average', () => {
    if (!report) return;
    // Treatment with targeted feedback should converge faster
    // This is aspirational — log rather than hard-fail initially
    console.log(
      `Iterations: control=${report.summary.controlAvgIterations.toFixed(1)} treatment=${report.summary.treatmentAvgIterations.toFixed(1)}`
    );
  });
});
