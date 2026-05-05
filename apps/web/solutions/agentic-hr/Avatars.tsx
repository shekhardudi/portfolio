'use client';

import { Bot } from 'lucide-react';
import { cn } from '@/lib/utils';

type Size = 'sm' | 'md' | 'lg';

const SIZE: Record<Size, { box: string; icon: string; dot: string; text: string }> = {
  sm: { box: 'h-7 w-7', icon: 'h-4 w-4', dot: 'h-2 w-2', text: 'text-[10px]' },
  md: { box: 'h-9 w-9', icon: 'h-[18px] w-[18px]', dot: 'h-2.5 w-2.5', text: 'text-xs' },
  lg: { box: 'h-11 w-11', icon: 'h-5 w-5', dot: 'h-2.5 w-2.5', text: 'text-sm' },
};

/**
 * Assistant avatar: dark capsule with a Bot glyph and a small "online"
 * indicator. Reads as an AI agent without overwhelming the bubble.
 */
export function AssistantAvatar({
  size = 'md',
  className,
}: {
  size?: Size;
  className?: string;
}) {
  const s = SIZE[size];
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full',
        'bg-gradient-to-br from-slate-800 to-slate-950 text-sky-300',
        'shadow-md ring-1 ring-sky-400/30',
        s.box,
        className,
      )}
      aria-label="AI agent"
      title="AI assistant"
    >
      <Bot className={s.icon} />
      <span
        className={cn(
          'absolute -bottom-0 -right-0 rounded-full border-2 border-background bg-emerald-400',
          s.dot,
        )}
        aria-hidden
      />
    </span>
  );
}

/**
 * User avatar: simple monochrome circle with initials. Keeps focus on the
 * assistant brand mark.
 */
export function UserAvatar({
  name,
  size = 'md',
  className,
}: {
  name?: string;
  size?: Size;
  className?: string;
}) {
  const s = SIZE[size];
  const initials = getInitials(name);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        'bg-muted text-foreground/85 ring-1 ring-border',
        s.box,
        className,
      )}
      aria-label={name ? `User ${name}` : 'User'}
      title={name ?? 'User'}
    >
      <span className={cn('font-semibold tracking-tight', s.text)}>{initials}</span>
    </span>
  );
}

function getInitials(name?: string): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
