/**
 * Report generator — outputs JSON and Markdown benchmark reports.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DetectionReport, ABTestReport } from '../types.js';

const OUTPUT_DIR = join(process.cwd(), 'bench-results');

async function ensureDir(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
}

/**
 * Write detection report as JSON + Markdown.
 */
export async function writeDetectionReport(report: DetectionReport): Promise<{ json: string; md: string }> {
  await ensureDir();
  const ts = new Date(report.timestamp).toISOString().replace(/[:.]/g, '-');

  const jsonPath = join(OUTPUT_DIR, `detection-${ts}.json`);
  const mdPath = join(OUTPUT_DIR, `detection-${ts}.md`);

  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  await writeFile(mdPath, formatDetectionMarkdown(report));

  return { json: jsonPath, md: mdPath };
}

/**
 * Write agent A/B test report as JSON + Markdown.
 */
export async function writeAgentReport(report: ABTestReport): Promise<{ json: string; md: string }> {
  await ensureDir();
  const ts = new Date(report.timestamp).toISOString().replace(/[:.]/g, '-');

  const jsonPath = join(OUTPUT_DIR, `agent-${ts}.json`);
  const mdPath = join(OUTPUT_DIR, `agent-${ts}.md`);

  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  await writeFile(mdPath, formatAgentMarkdown(report));

  return { json: jsonPath, md: mdPath };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function usd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function ms(n: number): string {
  return `${n.toFixed(0)}ms`;
}

function formatDetectionMarkdown(report: DetectionReport): string {
  const lines: string[] = [];

  lines.push('# Saccadic AI Detection Benchmark Report');
  lines.push('');
  lines.push(`Generated: ${new Date(report.timestamp).toISOString()}`);
  lines.push('');

  // Aggregate
  lines.push('## Overall Accuracy');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Precision | ${pct(report.aggregate.precision)} |`);
  lines.push(`| Recall | ${pct(report.aggregate.recall)} |`);
  lines.push(`| F1 Score | ${pct(report.aggregate.f1)} |`);
  lines.push('');

  // By category
  lines.push('## By Category');
  lines.push('');
  lines.push('| Category | Precision | Recall | F1 | Count |');
  lines.push('|----------|-----------|--------|-----|-------|');
  for (const [cat, data] of Object.entries(report.byCategory)) {
    if (data.count > 0) {
      lines.push(`| ${cat} | ${pct(data.precision)} | ${pct(data.recall)} | ${pct(data.f1)} | ${data.count} |`);
    }
  }
  lines.push('');

  // By severity
  lines.push('## By Severity');
  lines.push('');
  lines.push('| Severity | Precision | Recall | F1 | Count |');
  lines.push('|----------|-----------|--------|-----|-------|');
  for (const [sev, data] of Object.entries(report.bySeverity)) {
    if (data.count > 0) {
      lines.push(`| ${sev} | ${pct(data.precision)} | ${pct(data.recall)} | ${pct(data.f1)} | ${data.count} |`);
    }
  }
  lines.push('');

  // Per-fixture
  lines.push('## Per Fixture');
  lines.push('');
  lines.push('| Fixture | TP | FP | FN | Precision | Recall | F1 |');
  lines.push('|---------|----|----|-----|-----------|--------|-----|');
  for (const r of report.results) {
    lines.push(`| ${r.fixtureId} | ${r.truePositives.length} | ${r.falsePositives.length} | ${r.falseNegatives.length} | ${pct(r.precision)} | ${pct(r.recall)} | ${pct(r.f1)} |`);
  }
  lines.push('');

  // Cost
  lines.push('## Cost');
  lines.push('');
  lines.push(`- Total time: ${ms(report.cost.totalTimeMs)}`);
  lines.push(`- Peak memory: ${report.cost.peakMemoryMb.toFixed(1)}MB`);
  lines.push('');

  return lines.join('\n');
}

function formatAgentMarkdown(report: ABTestReport): string {
  const lines: string[] = [];
  const s = report.summary;

  lines.push('# Saccadic AI Agent A/B Test Report');
  lines.push('');
  lines.push(`Generated: ${new Date(report.timestamp).toISOString()}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Control | Treatment | Delta |');
  lines.push('|--------|---------|-----------|-------|');
  lines.push(`| Avg Iterations | ${s.controlAvgIterations.toFixed(1)} | ${s.treatmentAvgIterations.toFixed(1)} | ${(s.treatmentAvgIterations - s.controlAvgIterations).toFixed(1)} |`);
  lines.push(`| Avg Score | ${pct(s.controlAvgScore)} | ${pct(s.treatmentAvgScore)} | ${pct(s.treatmentAvgScore - s.controlAvgScore)} |`);
  lines.push(`| Convergence Rate | ${pct(s.controlConvergenceRate)} | ${pct(s.treatmentConvergenceRate)} | ${pct(s.treatmentConvergenceRate - s.controlConvergenceRate)} |`);
  lines.push(`| Avg Cost | ${usd(s.controlAvgCostUsd)} | ${usd(s.treatmentAvgCostUsd)} | ${usd(s.treatmentAvgCostUsd - s.controlAvgCostUsd)} |`);
  lines.push('');

  // Per-fixture detail
  lines.push('## Per Fixture');
  lines.push('');
  lines.push('| Fixture | Ctrl Grade | Treat Grade | Ctrl Iters | Treat Iters | Ctrl Cost | Treat Cost |');
  lines.push('|---------|-----------|-------------|------------|-------------|-----------|------------|');
  for (let i = 0; i < report.fixtures.length; i++) {
    const ctrl = report.control[i];
    const treat = report.treatment[i];
    if (ctrl && treat) {
      lines.push(`| ${report.fixtures[i]} | ${ctrl.finalGrade} | ${treat.finalGrade} | ${ctrl.iterations.length} | ${treat.iterations.length} | ${usd(ctrl.totalCostUsd)} | ${usd(treat.totalCostUsd)} |`);
    }
  }
  lines.push('');

  // Cost
  lines.push('## Cost');
  lines.push('');
  lines.push(`- Total time: ${ms(report.cost.totalTimeMs)}`);
  lines.push(`- Total tokens: ${report.cost.totalInputTokens + report.cost.totalOutputTokens}`);
  lines.push(`- Total cost: ${usd(report.cost.totalCostUsd)}`);
  lines.push('');

  return lines.join('\n');
}
