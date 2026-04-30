'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, X } from 'lucide-react';
import { HOW_IT_WORKS, TIPS } from './guide';

interface Props {
  /** When true, renders the inline right-rail panel (mirrors original
   *  Streamlit `📖 Guide` toggle). When false, renders nothing. */
  open: boolean;
  onClose: () => void;
}

/**
 * Inline guide rail — mirrors the original Streamlit chat layout where the
 * guide sits to the right of the conversation as a toggleable, fixed-width
 * column rather than a popover/drawer.
 */
export default function GuidePanel({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <aside className="flex h-[520px] flex-col rounded-xl border border-border bg-muted/40">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <BookOpen className="h-3.5 w-3.5" /> How it works
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-foreground/70 hover:bg-muted hover:text-foreground"
          aria-label="Close guide"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="prose prose-invert max-w-none text-xs prose-p:my-1.5 prose-li:my-0">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{HOW_IT_WORKS}</ReactMarkdown>
        </div>
        <h3 className="mt-4 text-sm font-semibold">Tips</h3>
        <div className="prose prose-invert max-w-none text-xs prose-p:my-1.5 prose-li:my-0">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{TIPS}</ReactMarkdown>
        </div>
      </div>
    </aside>
  );
}
