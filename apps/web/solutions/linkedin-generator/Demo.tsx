'use client';

import { useEffect, useState } from 'react';
import {
  Hammer,
  PenLine,
  RefreshCw,
  Telescope,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toaster';
import { clearDemoState, useDemoState } from './useDemoState';
import ScoutPanel from './ScoutPanel';
import ProductionStudio from './ProductionStudio';
import FinalOutput from './FinalOutput';
import ImageStudio from './ImageStudio';
import CostTracker from './CostTracker';

type InnerTab = 'scout' | 'studio' | 'output';

export default function Demo() {
  const [state, dispatch] = useDemoState();
  const [innerTab, setInnerTab] = useState<InnerTab>(() =>
    state.crew_done ? 'output' : state.pulse_done ? 'studio' : 'scout',
  );
  const { show: toast } = useToast();
  const busy =
    state.job_status === 'queued' ||
    state.job_status === 'running' ||
    state.scout_status === 'queued' ||
    state.scout_status === 'running';

  // When the crew finishes a run, nudge the user to Output tab once.
  useEffect(() => {
    if (state.crew_done && innerTab === 'studio') {
      // ProductionStudio's CompletionPanel has the explicit "See output"
      // button — keep the user where they are, don't auto-jump.
    }
  }, [state.crew_done, innerTab]);

  function importToStudio(heading: string, body: string) {
    const trimmed = heading === '__intro__' ? body : `${heading}\n\n${body}`;
    dispatch({ type: 'IMPORT_TOPIC', topic: trimmed.slice(0, 280) });
    setInnerTab('studio');
    toast({
      title: 'Imported into Studio',
      description: heading === '__intro__' ? 'Intro section' : heading,
    });
  }

  function reset() {
    clearDemoState();
    dispatch({ type: 'RESET' });
    setInnerTab('scout');
    toast({ title: 'Session reset', description: 'Cleared local draft + image.' });
  }

  return (
    <div className="space-y-3">
      <Tabs value={innerTab} onValueChange={(v) => setInnerTab(v as InnerTab)}>
        <TabsList>
          <TabsTrigger value="scout">
            <span className="inline-flex items-center gap-1.5">
              <Telescope className="h-3.5 w-3.5" />
              Scout
              {state.pulse_done && (
                <span className="ml-0.5 inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              )}
            </span>
          </TabsTrigger>
          <TabsTrigger value="studio">
            <span className="inline-flex items-center gap-1.5">
              <Hammer className="h-3.5 w-3.5" />
              Studio
              {busy && (
                <span className="ml-0.5 inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
              )}
            </span>
          </TabsTrigger>
          <TabsTrigger value="output">
            <span className="inline-flex items-center gap-1.5">
              <PenLine className="h-3.5 w-3.5" />
              Output
              {state.crew_done && (
                <span className="ml-0.5 inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              )}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="scout">
          <ScoutPanel state={state} dispatch={dispatch} onImport={importToStudio} />
        </TabsContent>

        <TabsContent value="studio">
          <ProductionStudio
            state={state}
            dispatch={dispatch}
            onCompleted={() => setInnerTab('output')}
          />
        </TabsContent>

        <TabsContent value="output">
          <div className="grid gap-4">
            <CostTracker cost={state.cost} kind="studio" />
            <FinalOutput state={state} dispatch={dispatch} onReset={reset} />
            <ImageStudio state={state} dispatch={dispatch} />
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-muted/20 px-3 py-2.5">
        <p className="text-[11px] text-foreground/65">
          CrewAI multi-agent + GPT-image-1. Drafts/images persist locally; backend run state is
          only retained for the live session.
        </p>
        <button
          onClick={reset}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Reset session
        </button>
      </div>
    </div>
  );
}
