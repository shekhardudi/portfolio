'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { IntentChip } from './chips';

const CHIP_ICON: Record<IntentChip['type'], string> = {
  location: '📍',
  industry: '🏭',
  activity: '⚡',
  size: '📊',
};

const CHIP_TYPE_LABEL: Record<IntentChip['type'], string> = {
  location: 'Location',
  industry: 'Industry',
  activity: 'Activity',
  size: 'Size',
};

const CHIP_COLOR: Record<IntentChip['type'], string> = {
  location: 'border-blue-500/40 bg-blue-500/10 text-blue-200',
  industry: 'border-violet-500/40 bg-violet-500/10 text-violet-200',
  activity: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  size: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
};

export default function GhostChips({ chips }: { chips: IntentChip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <AnimatePresence>
        {chips.map((c) => (
          <motion.span
            key={`${c.type}:${c.label}`}
            layout
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]',
              CHIP_COLOR[c.type],
            )}
          >
            <span>{CHIP_ICON[c.type]}</span>
            <span className="opacity-70">{CHIP_TYPE_LABEL[c.type]}:</span>
            <span className="font-medium">{c.label}</span>
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
