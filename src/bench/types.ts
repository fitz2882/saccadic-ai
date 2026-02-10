/**
 * Benchmark framework types for Saccadic AI evaluation.
 */

import type { DesignState, FeedbackItem } from '../core/types.js';

// ── Ground Truth ──

export type IssueCategory = 'color' | 'spacing' | 'typography' | 'layout' | 'size' | 'missing' | 'extra';
export type SeverityLevel = 'imperceptible' | 'noticeable' | 'major';

export interface GroundTruthIssue {
  category: IssueCategory;
  severity: SeverityLevel;
  element: string;       // CSS selector
  property: string;      // CSS property or 'element' for missing/extra
  expected: string;
  actual: string;
  description: string;
}

// ── Test Fixtures ──

export interface TestFixture {
  id: string;
  name: string;
  category: IssueCategory;
  designHtml: string;
  buildHtml: string;
  designState: DesignState;
  groundTruth: GroundTruthIssue[];
}

// ── Detection Scoring ──

export interface MatchedPair {
  groundTruth: GroundTruthIssue;
  feedback: FeedbackItem;
  confidence: number;
}

export interface DetectionResult {
  fixtureId: string;
  truePositives: MatchedPair[];
  falsePositives: FeedbackItem[];
  falseNegatives: GroundTruthIssue[];
  precision: number;
  recall: number;
  f1: number;
}

export interface DetectionReport {
  results: DetectionResult[];
  aggregate: {
    precision: number;
    recall: number;
    f1: number;
  };
  byCategory: Record<IssueCategory, { precision: number; recall: number; f1: number; count: number }>;
  bySeverity: Record<SeverityLevel, { precision: number; recall: number; f1: number; count: number }>;
  cost: CostSnapshot;
  timestamp: number;
}

// ── Agent A/B Testing ──

export interface AgentTrialConfig {
  fixtureId: string;
  designDescription: string;
  maxIterations: number;
  model: string;
  withFeedback: boolean;  // control=false, treatment=true
}

export interface AgentIteration {
  iteration: number;
  html: string;
  grade: string;
  matchPercentage: number;
  feedbackCount: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AgentTrialResult {
  config: AgentTrialConfig;
  iterations: AgentIteration[];
  converged: boolean;
  finalGrade: string;
  finalMatchPercentage: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  durationMs: number;
}

export interface ABTestReport {
  fixtures: string[];
  control: AgentTrialResult[];
  treatment: AgentTrialResult[];
  summary: {
    controlAvgIterations: number;
    treatmentAvgIterations: number;
    controlAvgScore: number;
    treatmentAvgScore: number;
    controlConvergenceRate: number;
    treatmentConvergenceRate: number;
    controlAvgCostUsd: number;
    treatmentAvgCostUsd: number;
  };
  cost: CostSnapshot;
  timestamp: number;
}

// ── Cost Tracking ──

export interface CostSnapshot {
  totalTimeMs: number;
  peakMemoryMb: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  operations: OperationCost[];
}

export interface OperationCost {
  label: string;
  durationMs: number;
  memoryDeltaMb: number;
}

// ── Token Pricing ──

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-20250514': { inputPer1M: 3, outputPer1M: 15 },
  'claude-haiku-3-5-20241022': { inputPer1M: 0.80, outputPer1M: 4 },
};
