import { describe, it, expect } from 'vitest';
import { TokenVersioning } from './token-versioning.js';
import type { DesignTokens } from './types.js';

function makeTokens(overrides: Partial<DesignTokens> = {}): DesignTokens {
  return {
    colors: { primary: '#FF0000', secondary: '#00FF00' },
    spacing: { sm: '4px', md: '8px', lg: '16px' },
    typography: {
      heading: { fontFamily: 'Inter', fontSize: '24px', fontWeight: '700', lineHeight: '32px' },
      body: { fontFamily: 'Inter', fontSize: '16px', fontWeight: '400', lineHeight: '24px' },
    },
    shadows: { sm: '0 1px 2px rgba(0,0,0,0.1)' },
    borders: { default: '1px solid #E0E0E0' },
    radii: { sm: '4px', md: '8px' },
    ...overrides,
  };
}

describe('TokenVersioning', () => {
  const versioning = new TokenVersioning();

  it('identical tokens produce empty diff', () => {
    const tokens = makeTokens();
    const diff = versioning.diff(tokens, tokens);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.breaking).toBe(false);
  });

  it('detects added tokens (non-breaking)', () => {
    const oldTokens = makeTokens();
    const newTokens = makeTokens({ colors: { ...oldTokens.colors, accent: '#0000FF' } });
    const diff = versioning.diff(oldTokens, newTokens);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].path).toBe('colors.accent');
    expect(diff.added[0].isBreaking).toBe(false);
    expect(diff.breaking).toBe(false);
  });

  it('detects removed tokens (breaking)', () => {
    const oldTokens = makeTokens();
    const newTokens = makeTokens({ colors: { primary: '#FF0000' } }); // removed secondary
    const diff = versioning.diff(oldTokens, newTokens);
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].path).toBe('colors.secondary');
    expect(diff.removed[0].isBreaking).toBe(true);
    expect(diff.breaking).toBe(true);
  });

  it('detects changed values (breaking)', () => {
    const oldTokens = makeTokens();
    const newTokens = makeTokens({ colors: { primary: '#0000FF', secondary: '#00FF00' } });
    const diff = versioning.diff(oldTokens, newTokens);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].path).toBe('colors.primary');
    expect(diff.changed[0].oldValue).toBe('#FF0000');
    expect(diff.changed[0].newValue).toBe('#0000FF');
    expect(diff.changed[0].isBreaking).toBe(true);
    expect(diff.breaking).toBe(true);
  });

  it('detects typography changes', () => {
    const oldTokens = makeTokens();
    const newTokens = makeTokens({
      typography: {
        ...oldTokens.typography,
        heading: { fontFamily: 'Inter', fontSize: '28px', fontWeight: '700', lineHeight: '36px' },
      },
    });
    const diff = versioning.diff(oldTokens, newTokens);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].path).toBe('typography.heading');
    expect(diff.changed[0].isBreaking).toBe(true);
  });

  it('typography: adding new sub-property is non-breaking', () => {
    const oldTokens = makeTokens();
    const newTokens = makeTokens({
      typography: {
        ...oldTokens.typography,
        heading: {
          fontFamily: 'Inter',
          fontSize: '24px',
          fontWeight: '700',
          lineHeight: '32px',
          letterSpacing: '-0.5px',
        },
      },
    });
    const diff = versioning.diff(oldTokens, newTokens);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].isBreaking).toBe(false);
  });

  it('handles multiple categories of changes', () => {
    const oldTokens = makeTokens();
    const newTokens = makeTokens({
      colors: { primary: '#0000FF', secondary: '#00FF00', accent: '#FF00FF' },
      spacing: { sm: '4px', md: '12px', lg: '16px', xl: '24px' },
    });
    const diff = versioning.diff(oldTokens, newTokens);
    expect(diff.added.length).toBeGreaterThanOrEqual(2); // accent + xl
    expect(diff.changed.length).toBeGreaterThanOrEqual(2); // primary + md
    expect(diff.breaking).toBe(true);
  });

  it('handles empty token categories', () => {
    const oldTokens = makeTokens({ shadows: {} });
    const newTokens = makeTokens({ shadows: { lg: '0 4px 8px rgba(0,0,0,0.2)' } });
    const diff = versioning.diff(oldTokens, newTokens);
    expect(diff.added.some((c) => c.path === 'shadows.lg')).toBe(true);
  });
});
