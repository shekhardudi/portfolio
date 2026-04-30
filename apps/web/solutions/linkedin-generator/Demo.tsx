'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
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
    <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
      <Tabs value={innerTab} onValueChange={(v) => setInnerTab(v as InnerTab)}>
        <TabsList>
          <TabsTrigger value="scout">Scout</TabsTrigger>
          <TabsTrigger value="studio">Studio</TabsTrigger>
          <TabsTrigger value="output">Output</TabsTrigger>
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
            <FinalOutput state={state} dispatch={dispatch} onReset={reset} />
            <ImageStudio state={state} dispatch={dispatch} />
          </div>
        </TabsContent>
      </Tabs>

      <aside className="space-y-3">
        <CostTracker cost={state.cost} />
        <button
          onClick={reset}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Reset session
        </button>
        <p className="rounded-md border border-border bg-muted/40 p-2.5 text-xs text-foreground/70">
          Powered by GPT-4o + Claude + DALL-E. Draft + image persist in your browser only.
        </p>
      </aside>
    </div>
  );
}
