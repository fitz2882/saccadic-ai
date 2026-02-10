/**
 * Token Versioning - Design token diff engine.
 *
 * Deep-diffs two DesignTokens objects, classifies changes as additive (safe)
 * vs breaking (removal, value change), and reports a structured TokenDiff.
 */

import type { DesignTokens, TokenDiff, TokenChange } from './types.js';

export class TokenVersioning {
  /**
   * Compare two DesignTokens objects and return a structured diff.
   */
  diff(oldTokens: DesignTokens, newTokens: DesignTokens): TokenDiff {
    const changes: { added: TokenChange[]; removed: TokenChange[]; changed: TokenChange[] } = {
      added: [],
      removed: [],
      changed: [],
    };

    const categories: Array<keyof DesignTokens> = [
      'colors',
      'spacing',
      'typography',
      'shadows',
      'borders',
      'radii',
    ];

    for (const category of categories) {
      const oldCat = oldTokens[category] as Record<string, unknown>;
      const newCat = newTokens[category] as Record<string, unknown>;

      if (!oldCat && !newCat) continue;

      const oldKeys = new Set(Object.keys(oldCat || {}));
      const newKeys = new Set(Object.keys(newCat || {}));

      // Added tokens
      for (const key of newKeys) {
        if (!oldKeys.has(key)) {
          changes.added.push({
            path: `${category}.${key}`,
            category,
            newValue: this.stringify(newCat[key]),
            isBreaking: false,
          });
        }
      }

      // Removed tokens (breaking)
      for (const key of oldKeys) {
        if (!newKeys.has(key)) {
          changes.removed.push({
            path: `${category}.${key}`,
            category,
            oldValue: this.stringify(oldCat[key]),
            isBreaking: true,
          });
        }
      }

      // Changed tokens
      for (const key of oldKeys) {
        if (!newKeys.has(key)) continue;
        const oldVal = oldCat[key];
        const newVal = newCat[key];
        if (!this.deepEqual(oldVal, newVal)) {
          const isBreaking = this.isBreakingChange(category, oldVal, newVal);
          changes.changed.push({
            path: `${category}.${key}`,
            category,
            oldValue: this.stringify(oldVal),
            newValue: this.stringify(newVal),
            isBreaking,
          });
        }
      }
    }

    const breaking =
      changes.removed.length > 0 ||
      changes.changed.some((c) => c.isBreaking);

    return { ...changes, breaking };
  }

  /**
   * Determine if a value change is breaking.
   * Color value changes and typography changes are considered breaking.
   * Spacing/size changes are breaking.
   * Adding new sub-properties is non-breaking.
   */
  private isBreakingChange(category: string, oldVal: unknown, newVal: unknown): boolean {
    // Primitive value changes are always breaking
    if (typeof oldVal !== 'object' || typeof newVal !== 'object') {
      return true;
    }

    // For typography objects, check if any existing property changed
    if (oldVal && newVal) {
      const oldObj = oldVal as Record<string, unknown>;
      const newObj = newVal as Record<string, unknown>;
      for (const key of Object.keys(oldObj)) {
        if (key in newObj && oldObj[key] !== newObj[key]) {
          return true;
        }
      }
      // Only new properties added = non-breaking
      return false;
    }

    return true;
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object' || a === null || b === null) return false;

    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);

    for (const key of keys) {
      if (!this.deepEqual(aObj[key], bObj[key])) return false;
    }
    return true;
  }

  private stringify(val: unknown): string {
    if (typeof val === 'string') return val;
    return JSON.stringify(val);
  }
}
