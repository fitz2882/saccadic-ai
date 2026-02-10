/**
 * Fixture registry — aggregates all test fixtures.
 */

import type { TestFixture, IssueCategory, SeverityLevel } from '../types.js';
import { getColorFixtures } from './color.js';
import { getSpacingFixtures } from './spacing.js';
import { getTypographyFixtures } from './typography.js';
import { getLayoutFixtures } from './layout.js';
import { getElementFixtures } from './elements.js';
import { getCompoundFixtures } from './compound.js';

let _cache: TestFixture[] | null = null;

export function getAllFixtures(): TestFixture[] {
  if (!_cache) {
    _cache = [
      ...getColorFixtures(),
      ...getSpacingFixtures(),
      ...getTypographyFixtures(),
      ...getLayoutFixtures(),
      ...getElementFixtures(),
      ...getCompoundFixtures(),
    ];
  }
  return [..._cache];
}

export function getFixturesByCategory(category: IssueCategory): TestFixture[] {
  return getAllFixtures().filter((f) => f.category === category);
}

export function getFixturesBySeverity(severity: SeverityLevel): TestFixture[] {
  return getAllFixtures().filter((f) =>
    f.groundTruth.some((gt) => gt.severity === severity)
  );
}

export function getFixtureById(id: string): TestFixture | undefined {
  return getAllFixtures().find((f) => f.id === id);
}
