import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VLMComparator } from './vlm-comparator.js';
import { PNG } from 'pngjs';

function createTestPNG(): Buffer {
  const png = new PNG({ width: 16, height: 16 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 128;
    png.data[i + 1] = 128;
    png.data[i + 2] = 128;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

describe('VLMComparator', () => {
  it('isAvailable returns false without API key', () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const comparator = new VLMComparator();
    expect(comparator.isAvailable()).toBe(false);
    if (original) process.env.ANTHROPIC_API_KEY = original;
  });

  it('isAvailable returns true with API key', () => {
    const comparator = new VLMComparator('test-key');
    expect(comparator.isAvailable()).toBe(true);
  });

  it('throws without API key when comparing', async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const comparator = new VLMComparator();
    const img = createTestPNG();
    await expect(
      comparator.compare({ designImage: img, buildImage: img })
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
    if (original) process.env.ANTHROPIC_API_KEY = original;
  });

  it('compare calls Anthropic API and returns evaluation', async () => {
    const mockResponse = {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            overallAssessment: 'Good match overall',
            issues: [
              {
                description: 'Color slightly off on header',
                severity: 'minor',
                category: 'color',
                element: '.header',
              },
            ],
            qualityScore: 0.85,
            suggestions: ['Adjust header background color'],
          }),
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    // Mock the dynamic import of @anthropic-ai/sdk
    const mockCreate = vi.fn().mockResolvedValue(mockResponse);
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class MockAnthropic {
        messages = { create: mockCreate };
        constructor() {}
      },
    }));

    // Re-import to pick up the mock
    const { VLMComparator: MockedVLMComparator } = await import('./vlm-comparator.js');
    const comparator = new MockedVLMComparator('test-key');

    const img = createTestPNG();
    const result = await comparator.compare({ designImage: img, buildImage: img });

    expect(result.overallAssessment).toBe('Good match overall');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe('minor');
    expect(result.qualityScore).toBe(0.85);
    expect(result.suggestions).toHaveLength(1);
    expect(result.tokensUsed).toBe(150);
    expect(result.model).toContain('claude');

    vi.doUnmock('@anthropic-ai/sdk');
  });

  it('handles malformed VLM response gracefully', async () => {
    const mockResponse = {
      content: [{ type: 'text' as const, text: 'Not valid JSON at all' }],
      usage: { input_tokens: 50, output_tokens: 20 },
    };

    const mockCreate = vi.fn().mockResolvedValue(mockResponse);
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class MockAnthropic {
        messages = { create: mockCreate };
        constructor() {}
      },
    }));

    const { VLMComparator: MockedVLMComparator } = await import('./vlm-comparator.js');
    const comparator = new MockedVLMComparator('test-key');

    const img = createTestPNG();
    const result = await comparator.compare({ designImage: img, buildImage: img });

    expect(result.overallAssessment).toBe('Not valid JSON at all');
    expect(result.issues).toHaveLength(0);
    expect(result.qualityScore).toBe(0.5);

    vi.doUnmock('@anthropic-ai/sdk');
  });
});
