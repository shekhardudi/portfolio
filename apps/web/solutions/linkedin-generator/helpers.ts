/**
 * TS ports of the Streamlit-side helpers in linkedin_post_generator/app.py.
 * Behaviour-equivalent so the UI can render Pulse output without a backend round-trip.
 */

import type { TimeUnit } from './modules';

/** Split markdown on `## ` headings → { heading: body }. */
export function parseH2Sections(md: string): Record<string, string> {
  if (!md) return {};
  const parts = md.split(/\n(?=## )/);
  const out: Record<string, string> = {};
  for (const part of parts) {
    const lines = part.trim().split(/\r?\n/);
    if (lines.length === 0) continue;
    const head = lines[0];
    if (head.startsWith('## ')) {
      out[head.slice(3).trim()] = lines.slice(1).join('\n').trim();
    } else {
      out['__intro__'] = part.trim();
    }
  }
  return out;
}

/** Parse critic output into [post, dallePrompt]. */
export function extractFinalizedPost(raw: string): [string, string] {
  const postMatch = /##\s*Finalized Post\s*\n([\s\S]*?)(?=\n##\s*DALL-?E Prompt|$)/i.exec(raw);
  const dalleMatch = /##\s*DALL-?E Prompt\s*\n([\s\S]*)$/i.exec(raw);
  const post = postMatch ? postMatch[1].trim() : raw.trim();
  const dalle = dalleMatch ? dalleMatch[1].trim() : '';
  return [post, dalle];
}

/** Sentences with > 15 words — flagged as too dense for LinkedIn. */
export function checkReadability(text: string): string[] {
  const sentences = text.trim().split(/(?<=[.!?])\s+/);
  return sentences.filter((s) => s && s.split(/\s+/).length > 15);
}

/** Convert a (value, unit) pair into days. */
export function convertToDays(value: number, unit: TimeUnit): number {
  const factor = { days: 1, weeks: 7, months: 30, years: 365 }[unit];
  return value * factor;
}

/** Rough USD cost estimate using GPT-4o pricing (per 1M tokens). */
export function estimateCostUSD(inputTokens: number, outputTokens: number) {
  const IN_PER_M = 5;
  const OUT_PER_M = 15;
  return (inputTokens / 1_000_000) * IN_PER_M + (outputTokens / 1_000_000) * OUT_PER_M;
}

/** ~4 chars per token, rough. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
