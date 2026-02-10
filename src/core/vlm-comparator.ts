/**
 * VLM Comparator - Claude Vision integration for qualitative design assessment.
 *
 * Sends design + build screenshots side-by-side to Claude for subjective
 * analysis of visual hierarchy, brand consistency, and UI quality.
 * Optional, off by default. Requires ANTHROPIC_API_KEY.
 */

import type { VLMEvaluation, VLMIssue } from './types.js';

export interface VLMCompareOptions {
  designImage: Buffer;
  buildImage: Buffer;
  prompt?: string;
  model?: string;
}

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

const DEFAULT_PROMPT = `You are a design quality auditor comparing a design mockup (first image) to a built implementation (second image).

Analyze both images and provide:
1. An overall assessment of how well the build matches the design
2. Specific issues you notice (differences in layout, colors, typography, spacing, visual hierarchy)
3. A quality score from 0 to 1 (1 = perfect match)
4. Actionable suggestions to fix any issues

Respond in this exact JSON format:
{
  "overallAssessment": "string",
  "issues": [
    {
      "description": "string",
      "severity": "minor|moderate|major",
      "category": "string (e.g. color, spacing, typography, layout, alignment)",
      "element": "optional element identifier"
    }
  ],
  "qualityScore": 0.0,
  "suggestions": ["string"]
}`;

export class VLMComparator {
  private apiKey: string | undefined;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.ANTHROPIC_API_KEY;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async compare(options: VLMCompareOptions): Promise<VLMEvaluation> {
    if (!this.apiKey) {
      throw new Error('VLM comparison requires ANTHROPIC_API_KEY environment variable');
    }

    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: this.apiKey });

    const model = options.model || DEFAULT_MODEL;
    const prompt = options.prompt || DEFAULT_PROMPT;

    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt,
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: options.designImage.toString('base64'),
              },
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: options.buildImage.toString('base64'),
              },
            },
          ],
        },
      ],
    });

    const tokensUsed =
      (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

    const textBlock = response.content.find((block) => block.type === 'text');
    const text = textBlock && 'text' in textBlock ? textBlock.text : '';

    const parsed = this.parseResponse(text);

    return {
      ...parsed,
      model,
      tokensUsed,
    };
  }

  private parseResponse(text: string): Omit<VLMEvaluation, 'model' | 'tokensUsed'> {
    try {
      // Extract JSON from markdown code blocks if present
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = (jsonMatch ? jsonMatch[1] : text).trim();
      const data = JSON.parse(jsonStr);

      return {
        overallAssessment: data.overallAssessment || 'No assessment provided',
        issues: (data.issues || []).map((issue: Record<string, string>): VLMIssue => ({
          description: issue.description || '',
          severity: (['minor', 'moderate', 'major'].includes(issue.severity)
            ? issue.severity
            : 'moderate') as VLMIssue['severity'],
          category: issue.category || 'general',
          element: issue.element,
        })),
        qualityScore: Math.max(0, Math.min(1, Number(data.qualityScore) || 0)),
        suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
      };
    } catch {
      return {
        overallAssessment: text,
        issues: [],
        qualityScore: 0.5,
        suggestions: [],
      };
    }
  }
}
