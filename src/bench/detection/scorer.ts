/**
 * Detection accuracy scorer.
 *
 * Maps Saccadic AI's FeedbackItem[] to ground truth via greedy bipartite matching,
 * then computes precision, recall, and F1.
 */

import type { FeedbackItem } from '../../core/types.js';
import type {
  GroundTruthIssue,
  MatchedPair,
  DetectionResult,
  DetectionReport,
  IssueCategory,
  SeverityLevel,
  CostSnapshot,
} from '../types.js';

// Category mapping: FeedbackItem.category → GroundTruthIssue.category
const CATEGORY_MAP: Record<string, IssueCategory> = {
  color: 'color',
  spacing: 'spacing',
  typography: 'typography',
  layout: 'layout',
  size: 'size',
  missing: 'missing',
  extra: 'extra',
  rendering: 'color', // fallback
};

// Normalize camelCase to kebab-case for property comparison
function toKebab(s: string): string {
  return s.replace(/([A-Z])/g, (m) => '-' + m.toLowerCase());
}

// Map of equivalent properties for matching
const PROPERTY_ALIASES: Record<string, string[]> = {
  'background-color': ['background-color', 'backgroundColor', 'background'],
  'color': ['color'],
  'font-size': ['font-size', 'fontSize'],
  'font-weight': ['font-weight', 'fontWeight'],
  'font-family': ['font-family', 'fontFamily'],
  'line-height': ['line-height', 'lineHeight'],
  'letter-spacing': ['letter-spacing', 'letterSpacing'],
  'width': ['width'],
  'height': ['height'],
  'padding': ['padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
               'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
  'gap': ['gap'],
  'border-radius': ['border-radius', 'borderRadius'],
  'x': ['x', 'left', 'position'],
  'y': ['y', 'top', 'position'],
  'position': ['position', 'x', 'y', 'left', 'top'],
};

/**
 * Compute match confidence between a ground truth issue and a feedback item.
 * Returns 0-1, higher = better match.
 */
function matchConfidence(gt: GroundTruthIssue, fb: FeedbackItem): number {
  let score = 0;

  // Category match (0.4 weight)
  const mappedCategory = CATEGORY_MAP[fb.category] ?? fb.category;
  if (mappedCategory === gt.category) {
    score += 0.4;
  }

  // Element overlap (0.3 weight)
  if (fb.element && gt.element) {
    const fbEl = fb.element.toLowerCase();
    const gtEl = gt.element.toLowerCase();
    if (fbEl === gtEl) {
      score += 0.3;
    } else if (fbEl.includes(gtEl) || gtEl.includes(fbEl)) {
      score += 0.2;
    }
  }

  // Property match (0.3 weight)
  if (gt.property) {
    const gtProp = gt.property.toLowerCase();
    const gtPropKebab = toKebab(gt.property).toLowerCase();
    const msg = (fb.message ?? '').toLowerCase();

    // Check direct property mention in message
    const aliases = PROPERTY_ALIASES[gtPropKebab] ?? [gtProp, gtPropKebab];
    const propertyMatched = aliases.some((alias) => msg.includes(alias.toLowerCase()));

    if (propertyMatched) {
      score += 0.3;
    } else if (fb.category === 'missing' && gt.category === 'missing') {
      score += 0.15;
    } else if (fb.category === 'extra' && gt.category === 'extra') {
      score += 0.15;
    } else if (mappedCategory === gt.category && fb.element && gt.element) {
      // Same category + same element = likely match even without exact property
      const fbEl = fb.element.toLowerCase();
      const gtEl = gt.element.toLowerCase();
      if (fbEl === gtEl || fbEl.includes(gtEl) || gtEl.includes(fbEl)) {
        score += 0.1;
      }
    }
  } else {
    // No property in ground truth (e.g., missing/extra) — category + element is enough
    if (fb.category === 'missing' && gt.category === 'missing') {
      score += 0.15;
    } else if (fb.category === 'extra' && gt.category === 'extra') {
      score += 0.15;
    }
  }

  return score;
}

/**
 * Score a single fixture's detection results against ground truth.
 */
export function scoreFixture(
  fixtureId: string,
  feedback: FeedbackItem[],
  groundTruth: GroundTruthIssue[],
): DetectionResult {
  // Filter out 'pass' feedback items — they are not detections
  const detections = feedback.filter((f) => f.severity !== 'pass');

  // If no ground truth, all detections are false positives
  if (groundTruth.length === 0) {
    return {
      fixtureId,
      truePositives: [],
      falsePositives: detections,
      falseNegatives: [],
      precision: detections.length === 0 ? 1 : 0,
      recall: 1, // nothing to find, so recall is perfect
      f1: detections.length === 0 ? 1 : 0,
    };
  }

  // Build confidence matrix
  const pairs: Array<{ gt: number; fb: number; confidence: number }> = [];
  for (let gi = 0; gi < groundTruth.length; gi++) {
    for (let fi = 0; fi < detections.length; fi++) {
      const conf = matchConfidence(groundTruth[gi], detections[fi]);
      if (conf > 0.3) { // Minimum threshold to consider a match
        pairs.push({ gt: gi, fb: fi, confidence: conf });
      }
    }
  }

  // Greedy 1:1 matching sorted by confidence descending
  pairs.sort((a, b) => b.confidence - a.confidence);
  const usedGt = new Set<number>();
  const usedFb = new Set<number>();
  const truePositives: MatchedPair[] = [];

  for (const pair of pairs) {
    if (usedGt.has(pair.gt) || usedFb.has(pair.fb)) continue;
    usedGt.add(pair.gt);
    usedFb.add(pair.fb);
    truePositives.push({
      groundTruth: groundTruth[pair.gt],
      feedback: detections[pair.fb],
      confidence: pair.confidence,
    });
  }

  const falsePositives = detections.filter((_, i) => !usedFb.has(i));
  const falseNegatives = groundTruth.filter((_, i) => !usedGt.has(i));

  const tp = truePositives.length;
  const fp = falsePositives.length;
  const fn = falseNegatives.length;

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { fixtureId, truePositives, falsePositives, falseNegatives, precision, recall, f1 };
}

/**
 * Aggregate detection results into a full report.
 */
export function aggregateResults(
  results: DetectionResult[],
  cost: CostSnapshot,
): DetectionReport {
  // Overall aggregation
  let totalTp = 0;
  let totalFp = 0;
  let totalFn = 0;

  for (const r of results) {
    totalTp += r.truePositives.length;
    totalFp += r.falsePositives.length;
    totalFn += r.falseNegatives.length;
  }

  const precision = totalTp + totalFp > 0 ? totalTp / (totalTp + totalFp) : 0;
  const recall = totalTp + totalFn > 0 ? totalTp / (totalTp + totalFn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  // By category
  const categories: IssueCategory[] = ['color', 'spacing', 'typography', 'layout', 'size', 'missing', 'extra'];
  const byCategory = {} as DetectionReport['byCategory'];

  for (const cat of categories) {
    let tp = 0, fp = 0, fn = 0;
    for (const r of results) {
      tp += r.truePositives.filter((m) => m.groundTruth.category === cat).length;
      fp += r.falsePositives.filter((f) => (CATEGORY_MAP[f.category] ?? f.category) === cat).length;
      fn += r.falseNegatives.filter((g) => g.category === cat).length;
    }
    const p = tp + fp > 0 ? tp / (tp + fp) : 0;
    const r = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f = p + r > 0 ? (2 * p * r) / (p + r) : 0;
    byCategory[cat] = { precision: p, recall: r, f1: f, count: tp + fn };
  }

  // By severity
  const severities: SeverityLevel[] = ['imperceptible', 'noticeable', 'major'];
  const bySeverity = {} as DetectionReport['bySeverity'];

  for (const sev of severities) {
    let tp = 0, fp = 0, fn = 0;
    for (const r of results) {
      tp += r.truePositives.filter((m) => m.groundTruth.severity === sev).length;
      fn += r.falseNegatives.filter((g) => g.severity === sev).length;
    }
    // FP severity is harder to determine — count overall FP proportionally
    fp = 0; // FPs don't have a ground truth severity
    const p = tp + fp > 0 ? tp / (tp + fp) : tp > 0 ? 1 : 0;
    const r = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f = p + r > 0 ? (2 * p * r) / (p + r) : 0;
    bySeverity[sev] = { precision: p, recall: r, f1: f, count: tp + fn };
  }

  return {
    results,
    aggregate: { precision, recall, f1 },
    byCategory,
    bySeverity,
    cost,
    timestamp: Date.now(),
  };
}
