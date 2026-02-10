/**
 * Cost tracker — instruments timing, memory, and token costs.
 */

import { performance } from 'node:perf_hooks';
import type { CostSnapshot, OperationCost, ModelPricing } from '../types.js';
import { MODEL_PRICING } from '../types.js';

export class CostTracker {
  private operations: OperationCost[] = [];
  private startMemory: number;
  private peakMemory: number;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCostUsd = 0;

  constructor() {
    const mem = process.memoryUsage();
    this.startMemory = mem.heapUsed;
    this.peakMemory = mem.heapUsed;
  }

  /**
   * Wrap an async operation with timing and memory tracking.
   */
  async track<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const memBefore = process.memoryUsage().heapUsed;
    const start = performance.now();

    try {
      return await fn();
    } finally {
      const durationMs = performance.now() - start;
      const memAfter = process.memoryUsage().heapUsed;
      const memoryDeltaMb = (memAfter - memBefore) / (1024 * 1024);

      this.operations.push({ label, durationMs, memoryDeltaMb });

      if (memAfter > this.peakMemory) {
        this.peakMemory = memAfter;
      }
    }
  }

  /**
   * Record token usage from an agent API call.
   */
  recordAgentTokens(inputTokens: number, outputTokens: number, model: string): void {
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;

    const pricing = this.getPricing(model);
    const cost =
      (inputTokens / 1_000_000) * pricing.inputPer1M +
      (outputTokens / 1_000_000) * pricing.outputPer1M;
    this.totalCostUsd += cost;
  }

  /**
   * Get cumulative cost summary.
   */
  getSummary(): CostSnapshot {
    const totalTimeMs = this.operations.reduce((sum, op) => sum + op.durationMs, 0);
    const peakMemoryMb = (this.peakMemory - this.startMemory) / (1024 * 1024);

    return {
      totalTimeMs,
      peakMemoryMb: Math.max(0, peakMemoryMb),
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalCostUsd: this.totalCostUsd,
      operations: [...this.operations],
    };
  }

  private getPricing(model: string): ModelPricing {
    // Try exact match, then prefix match
    if (MODEL_PRICING[model]) return MODEL_PRICING[model];
    for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
      if (model.startsWith(key.split('-').slice(0, 3).join('-'))) return pricing;
    }
    // Fallback to Sonnet pricing
    return { inputPer1M: 3, outputPer1M: 15 };
  }
}
