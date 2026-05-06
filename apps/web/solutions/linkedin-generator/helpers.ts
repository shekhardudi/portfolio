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

/**
 * Extract a short, quotable "take" from a scout-briefing section body.
 *
 * Strategy: walk the markdown line-by-line, skip headers, lists, code fences
 * and bold callout labels, return the first ordinary paragraph. Trim to a
 * sensible length so it fits on a card without truncating mid-sentence when
 * possible.
 */
export function extractHook(body: string, maxChars = 220): string {
  if (!body) return '';
  const lines = body.split(/\r?\n/);
  let inFence = false;
  const para: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!line) {
      if (para.length > 0) break; // first paragraph completed
      continue;
    }
    if (/^#{1,6}\s/.test(line)) continue;          // header
    if (/^[-*+]\s/.test(line)) continue;            // bullet
    if (/^\d+\.\s/.test(line)) continue;            // ordered list
    if (/^>\s/.test(line)) {
      para.push(line.replace(/^>\s*/, ''));
      continue;
    }
    if (/^\*\*[^*]+\*\*\s*[:\-—]/.test(line)) continue; // **Label:** ...
    para.push(line);
  }

  let out = para.join(' ').replace(/\s+/g, ' ').trim();
  if (!out) {
    // Fall back to the first non-empty, non-header line.
    out = lines
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#') && !l.startsWith('```')) ?? '';
    out = out.replace(/^[-*+>\d.\s]+/, '').trim();
  }

  // Light markdown stripping for display.
  out = out
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  if (out.length <= maxChars) return out;
  // Try to break at a sentence boundary near the cap.
  const window = out.slice(0, maxChars);
  const lastStop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
  if (lastStop >= maxChars * 0.6) return window.slice(0, lastStop + 1).trim();
  return window.trimEnd() + '…';
}

/** Drop trailing source-list artifacts that briefings often append to the heading copy. */
export function cleanHeading(heading: string): string {
  return heading.replace(/\s*\([^)]*\)\s*$/, '').trim() || heading;
}
