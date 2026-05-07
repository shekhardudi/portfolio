'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArchitectureImagePanel } from '@/components/architecture-image-panel';

interface MermaidDiagramProps {
  source?: string;
  sourcePath?: string;
  fallbackImagePath?: string;
  fallbackImageAlt?: string;
  theme?: 'default' | 'dark' | 'neutral' | 'forest' | 'base';
}

export function MermaidDiagram({
  source,
  sourcePath,
  fallbackImagePath,
  fallbackImageAlt,
  theme = 'dark',
}: MermaidDiagramProps) {
  const [resolvedSource, setResolvedSource] = useState<string | null>(source ?? null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const diagramId = useMemo(() => `mermaid-${Math.random().toString(36).slice(2)}`, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSource() {
      if (source) {
        setResolvedSource(source);
        setError(null);
        return;
      }
      if (!sourcePath) {
        setResolvedSource(null);
        setError('No Mermaid source provided.');
        return;
      }

      try {
        const response = await fetch(sourcePath);
        if (!response.ok) {
          throw new Error(`Could not load Mermaid source at ${sourcePath}`);
        }
        const text = await response.text();
        if (!cancelled) {
          setResolvedSource(text);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setResolvedSource(null);
          setError(err instanceof Error ? err.message : 'Failed to load Mermaid source.');
        }
      }
    }

    void loadSource();

    return () => {
      cancelled = true;
    };
  }, [source, sourcePath]);

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      if (!resolvedSource) return;
      try {
        const mermaid = (await import('mermaid')).default;
        const variants = buildSourceVariants(resolvedSource);
        let renderedSvg: string | null = null;
        let lastError: unknown = null;

        for (let index = 0; index < variants.length; index += 1) {
          const variant = variants[index];
          const hasFrontmatter = /^\s*---[\s\S]*?---/m.test(variant);
          try {
            mermaid.initialize({
              startOnLoad: false,
              ...(hasFrontmatter ? {} : { theme }),
              securityLevel: 'loose',
              flowchart: {
                useMaxWidth: false,
                htmlLabels: true,
              },
            });
            const result = await mermaid.render(`${diagramId}-${index}`, variant);
            renderedSvg = result.svg;
            break;
          } catch (err) {
            lastError = err;
          }
        }

        if (!renderedSvg) {
          throw lastError instanceof Error
            ? lastError
            : new Error('Failed to render Mermaid diagram.');
        }

        if (!cancelled) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setSvg(null);
          setError(err instanceof Error ? err.message : 'Failed to render Mermaid diagram.');
        }
      }
    }

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [diagramId, resolvedSource, theme]);

  if (error) {
    if (fallbackImagePath) {
      return <ArchitectureImagePanel src={fallbackImagePath} alt={fallbackImageAlt ?? 'Architecture diagram'} />;
    }
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-foreground/70">
        {error}
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="min-h-[72vh] bg-background px-2 py-8 text-center text-sm text-foreground/70">
        Rendering architecture diagram...
      </div>
    );
  }

  return (
    <div className="bg-background py-2">
      <div className="mb-3 flex items-center justify-between gap-3 px-1 py-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground/80 transition hover:border-foreground/30 hover:bg-muted"
          >
            Fit
          </button>
          <button
            type="button"
            onClick={() => setZoom((current) => Math.max(0.6, Number((current - 0.1).toFixed(2))))}
            className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground/80 transition hover:border-foreground/30 hover:bg-muted"
            aria-label="Zoom out"
          >
            -
          </button>
          <div className="min-w-12 text-center text-xs font-medium text-foreground/70">
            {Math.round(zoom * 100)}%
          </div>
          <button
            type="button"
            onClick={() => setZoom((current) => Math.min(2, Number((current + 0.1).toFixed(2))))}
            className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground/80 transition hover:border-foreground/30 hover:bg-muted"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>
      <div
        className="diagram-viewport mx-auto min-h-[72vh] w-full overflow-auto bg-background px-2 py-4"
      >
        <div
          className="diagram-canvas mx-auto"
          style={{
            width: `${zoom * 100}%`,
            minWidth: zoom <= 1 ? '100%' : `${zoom * 100}%`,
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      <style jsx>{`
        .diagram-viewport {
          scrollbar-gutter: stable both-edges;
        }

        .diagram-viewport :global(svg) {
          display: block;
          width: 100% !important;
          max-width: none !important;
          height: auto !important;
          background: transparent !important;
        }

        .diagram-viewport :global(svg[width]) {
          width: 100% !important;
        }

        .diagram-viewport :global(.label),
        .diagram-viewport :global(text) {
          fill: #f5f7fb !important;
        }
      `}</style>
    </div>
  );
}

function buildSourceVariants(sourceText: string): string[] {
  const stripped = sourceText.replace(/^\s*---[\s\S]*?---\s*/m, '');
  return stripped === sourceText ? [sourceText] : [sourceText, stripped];
}
