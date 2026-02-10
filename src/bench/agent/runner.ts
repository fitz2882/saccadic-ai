/**
 * Agent runner — wraps Anthropic SDK for agent trials.
 *
 * Sends design descriptions + optional Saccadic AI feedback to Claude
 * and returns generated HTML + token counts.
 */

import type { FeedbackItem } from '../../core/types.js';

export interface GenerateResult {
  html: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Build the system prompt for HTML generation.
 */
function systemPrompt(): string {
  return `You are an expert front-end developer. You generate clean, semantic HTML with inline styles that precisely match design specifications. Return ONLY the HTML code, no explanations or markdown fences.`;
}

/**
 * Build a control prompt (design description only).
 */
export function controlPrompt(designDescription: string, currentHtml?: string): string {
  let prompt = `Create an HTML page that matches this design:\n\n${designDescription}`;
  if (currentHtml) {
    prompt += `\n\nHere is your current HTML. Improve it to better match the design:\n\n${currentHtml}`;
  }
  return prompt;
}

/**
 * Build a treatment prompt (design description + Saccadic AI feedback).
 */
export function treatmentPrompt(
  designDescription: string,
  feedback: FeedbackItem[],
  currentHtml?: string,
): string {
  let prompt = `Create an HTML page that matches this design:\n\n${designDescription}`;
  if (currentHtml) {
    prompt += `\n\nHere is your current HTML:\n\n${currentHtml}`;
  }

  const issues = feedback.filter((f) => f.severity !== 'pass');
  if (issues.length > 0) {
    prompt += `\n\nSaccadic AI visual comparison detected these issues:\n`;
    for (const item of issues) {
      prompt += `\n- [${item.severity.toUpperCase()}] ${item.category}: ${item.message}`;
      if (item.fix) {
        prompt += `\n  Fix: ${item.fix}`;
      }
    }
    prompt += `\n\nPlease fix all the above issues.`;
  }

  return prompt;
}

/**
 * Extract HTML from model response (strips markdown fences if present).
 */
function extractHtml(text: string): string {
  // Strip ```html ... ``` wrapper if present
  const fenceMatch = text.match(/```(?:html)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  return text.trim();
}

export class AgentRunner {
  private client: InstanceType<typeof import('@anthropic-ai/sdk').default> | null = null;
  private model: string;

  constructor(model = 'claude-sonnet-4-20250514') {
    this.model = model;
  }

  /**
   * Lazy-init the Anthropic client.
   */
  private async getClient() {
    if (!this.client) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      this.client = new Anthropic();
    }
    return this.client;
  }

  /**
   * Generate HTML from a prompt.
   */
  async generateHtml(userPrompt: string): Promise<GenerateResult> {
    const client = await this.getClient();

    const response = await client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt(),
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => {
        if (block.type === 'text') return block.text;
        return '';
      })
      .join('');

    return {
      html: extractHtml(text),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}
