'use client';

import { useState } from 'react';
import {
  Hammer,
  Link2,
  PenLine,
  Telescope,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toaster';
import { useDemoState } from './useDemoState';
import ScoutPanel from './ScoutPanel';
import ProductionStudio from './ProductionStudio';
import FinalOutput from './FinalOutput';
import ImageStudio from './ImageStudio';
import CostTracker from './CostTracker';
import { useSolutionSession } from '@/lib/session/SessionProvider';

type InnerTab = 'scout' | 'studio' | 'output';

export default function Demo() {
  const [state, dispatch] = useDemoState();
  const [innerTab, setInnerTab] = useState<InnerTab>(() =>
    state.crew_done ? 'output' : state.pulse_done ? 'studio' : 'scout',
  );
  const { show: toast } = useToast();
  const session = useSolutionSession('linkedin-generator');
  const studioBusy =
    state.job_status === 'queued' || state.job_status === 'running';
  const scoutBusy =
    state.scout_status === 'queued' || state.scout_status === 'running';

  function importToStudio(topic: string, take: string, vibe?: string) {
    dispatch({ type: 'IMPORT_TOPIC', topic, leader_angle: take, author_vibe: vibe });
    setInnerTab('studio');
    toast({
      title: 'Imported into Studio',
      description: topic.slice(0, 80),
    });
  }

  function resetScout() {
    // Order matters: bump the session version FIRST so any in-flight poll
    // loops fail shouldAccept() before the reducer wipes the data they'd
    // dispatch into. The session also calls jobRegistry.cancelForSlug(),
    // which fires the registered cancel callbacks (best-effort backend).
    session.resetWorkspace('scout');
    dispatch({ type: 'RESET_SCOUT' });
    setInnerTab('scout');
    toast({
      title: 'Scout reset',
      description: 'Cleared briefing and active scout job. Studio is untouched.',
    });
  }

  function resetStudio() {
    session.resetWorkspace('studio');
    dispatch({ type: 'RESET_STUDIO' });
    setInnerTab('studio');
    toast({
      title: 'Studio reset',
      description: 'Cleared draft, post, and images. Scout briefing is untouched.',
    });
  }

  // ── Tab styling ────────────────────────────────────────────────────────
  // Scout is the *discovery* workspace — its outputs (briefing) are its
  // own. We accent it in sky/blue.
  //
  // Studio + Output are a *pipeline pair*: Studio runs the crew, Output
  // displays what that crew produced. They share the amber accent and are
  // visually chained with a small link icon between the two tabs to make
  // the relationship obvious at a glance.
  const SCOUT_ACCENT =
    'data-[state=active]:border-sky-400 data-[state=active]:text-sky-100 ' +
    'data-[state=active]:bg-sky-500/10';
  const STUDIO_ACCENT =
    'data-[state=active]:border-amber-400 data-[state=active]:text-amber-100 ' +
    'data-[state=active]:bg-amber-500/10';

  return (
    <div className="space-y-3">
      <Tabs value={innerTab} onValueChange={(v) => setInnerTab(v as InnerTab)}>
        <TabsList className="flex-wrap gap-0">
          {/* ── Discovery group ── */}
          <TabsTrigger value="scout" className={SCOUT_ACCENT}>
            <span className="inline-flex items-center gap-1.5">
              <Telescope className="h-3.5 w-3.5" />
              Scout
              {scoutBusy ? (
                <span className="ml-0.5 inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-sky-300" />
              ) : state.pulse_done ? (
                <span className="ml-0.5 inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              ) : null}
            </span>
          </TabsTrigger>

          {/* Vertical divider — separates the discovery workspace from the
              production pipeline so the two halves read as distinct. */}
          <span
            aria-hidden
            className="mx-2 h-5 w-px self-center bg-border"
          />

          {/* ── Production pipeline group: Studio → Output ──
              Wrapped together so the link icon sits *between* the two
              triggers (not floating above them) and they read as a pair. */}
          <div className="inline-flex items-center">
            <TabsTrigger value="studio" className={STUDIO_ACCENT}>
              <span className="inline-flex items-center gap-1.5">
                <Hammer className="h-3.5 w-3.5" />
                Studio
                {studioBusy && (
                  <span className="ml-0.5 inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
                )}
              </span>
            </TabsTrigger>
            <Link2
              aria-hidden
              className="mx-0.5 h-3 w-3 text-amber-400/70"
            />
            <TabsTrigger value="output" className={STUDIO_ACCENT}>
              <span className="inline-flex items-center gap-1.5">
                <PenLine className="h-3.5 w-3.5" />
                Output
                {state.crew_done && (
                  <span className="ml-0.5 inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                )}
              </span>
            </TabsTrigger>
          </div>
        </TabsList>

        <TabsContent value="scout">
          <ScoutPanel
            state={state}
            dispatch={dispatch}
            onImport={importToStudio}
            onReset={resetScout}
          />
        </TabsContent>

        <TabsContent value="studio">
          <ProductionStudio
            state={state}
            dispatch={dispatch}
            onCompleted={() => setInnerTab('output')}
            onReset={resetStudio}
          />
        </TabsContent>

        <TabsContent value="output">
          <div className="grid gap-4">
            <CostTracker cost={state.cost} kind="studio" />
            <FinalOutput state={state} dispatch={dispatch} onReset={resetStudio} />
            <ImageStudio state={state} dispatch={dispatch} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
