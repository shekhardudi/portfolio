'use client';

import * as Tabs from '@radix-ui/react-tabs';
import type { SolutionPlugin } from '@/solutions/_types';
import { cn } from '@/lib/utils';
import { DemoErrorBoundary } from '@/components/demo-error-boundary';
import { ArchitectureRenderer } from '@/components/architecture-renderer';

const TAB_LABELS: Record<string, string> = {
  overview: 'Overview',
  demo: 'Demo',
  architecture: 'Architecture',
  api: 'API',
  lessons: 'Lessons',
};

export function SolutionTabs({ solution }: { solution: SolutionPlugin }) {
  const tabs = solution.meta.tabs ?? ['overview', 'demo', 'architecture'];
  const Demo = solution.Demo;
  const CustomOverview = solution.Overview;
  const CustomApi = solution.API;

  return (
    <Tabs.Root defaultValue={tabs[0]} className="w-full">
      <Tabs.List className="flex gap-2 overflow-x-auto border-b border-border pb-1">
        {tabs.map((t) => (
          <Tabs.Trigger
            key={t}
            value={t}
            className={cn(
              '-mb-px whitespace-nowrap rounded-t-md border-b-2 border-transparent px-4 py-2 text-sm font-medium text-foreground/70 transition',
              'hover:text-foreground',
              'data-[state=active]:border-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            {TAB_LABELS[t] ?? t}
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      {tabs.includes('overview') && (
        <Tabs.Content value="overview" className="pt-8">
          {CustomOverview ? <CustomOverview /> : <Overview solution={solution} />}
        </Tabs.Content>
      )}

      {tabs.includes('demo') && (
        <Tabs.Content value="demo" className="pt-8">
          <DemoErrorBoundary>
            {Demo ? <Demo /> : <Placeholder label="Demo" />}
          </DemoErrorBoundary>
        </Tabs.Content>
      )}

      {tabs.includes('architecture') && (
        <Tabs.Content value="architecture" className="pt-8">
          <ArchitectureRenderer solution={solution} />
        </Tabs.Content>
      )}

      {tabs.includes('api') && (
        <Tabs.Content value="api" className="pt-8">
          {CustomApi ? <CustomApi /> : <Placeholder label="API reference" />}
        </Tabs.Content>
      )}

      {tabs.includes('lessons') && (
        <Tabs.Content value="lessons" className="pt-8">
          <Placeholder label="Lessons learned" />
        </Tabs.Content>
      )}
    </Tabs.Root>
  );
}

function Overview({ solution }: { solution: SolutionPlugin }) {
  return (
    <div className="prose prose-invert max-w-none">
      <h2>What it does</h2>
      <p>{solution.meta.tagline}</p>
      <ul>
        {solution.meta.highlights.map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ul>
    </div>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
      {label} content coming soon.
    </div>
  );
}
