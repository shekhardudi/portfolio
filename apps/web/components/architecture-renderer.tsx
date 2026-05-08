'use client';

import type { SolutionPlugin } from '@/solutions/_types';
import { ArchitectureImagePanel } from '@/components/architecture-image-panel';
import { MermaidDiagram } from '@/components/mermaid-diagram';

const APP_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '/portal';

export function ArchitectureRenderer({ solution }: { solution: SolutionPlugin }) {
  const config = solution.meta.architecture;
  const Architecture = solution.Architecture;
  const strategy = config?.strategy;
  const image = config?.image;
  const alt = config?.alt ?? `${solution.meta.title} architecture`;
  const mermaid = config?.mermaid;

  const renderComponent = () => (Architecture ? <Architecture /> : null);
  // If a Mermaid source path exists, we treat its sibling diagram.png as the
  // canonical static artifact. This lets each solution folder be self-contained
  // after file moves: /architectures/<slug>/diagram.mmd + diagram.png.
  const resolvedImagePath = withBasePath(
    derivePngFallbackPath(mermaid?.sourcePath) ?? image,
    APP_BASE_PATH,
  );
  const resolvedMermaidSourcePath = withBasePath(mermaid?.sourcePath, APP_BASE_PATH);
  const mermaidFallbackImage = resolvedImagePath;
  const renderMermaid = () => {
    if (!mermaid?.source && !resolvedMermaidSourcePath) return null;
    return (
      <MermaidDiagram
        source={mermaid?.source}
        sourcePath={resolvedMermaidSourcePath}
        fallbackImagePath={mermaidFallbackImage}
        fallbackImageAlt={alt}
        theme={mermaid?.theme}
      />
    );
  };
  const renderImage = () =>
    (resolvedImagePath ? <ArchitectureImagePanel src={resolvedImagePath} alt={alt} /> : null);

  // Default precedence when strategy is omitted.
  if (!strategy) {
    return renderMermaid() ?? renderComponent() ?? renderImage() ?? <ArchitecturePlaceholder />;
  }

  if (strategy === 'component') {
    return renderComponent() ?? renderMermaid() ?? renderImage() ?? <ArchitecturePlaceholder />;
  }
  if (strategy === 'mermaid') {
    return renderMermaid() ?? renderComponent() ?? renderImage() ?? <ArchitecturePlaceholder />;
  }
  return renderMermaid() ?? renderComponent() ?? renderImage() ?? <ArchitecturePlaceholder />;
}

function ArchitecturePlaceholder() {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
      Architecture content coming soon.
    </div>
  );
}

function derivePngFallbackPath(sourcePath?: string): string | undefined {
  if (!sourcePath) return undefined;
  if (sourcePath.endsWith('.mmd')) return sourcePath.replace(/\.mmd$/i, '.png');
  if (sourcePath.endsWith('.mermaid')) {
    return sourcePath.replace(/\.mermaid$/i, '.png');
  }
  return undefined;
}

function withBasePath(path: string | undefined, basePath: string): string | undefined {
  if (!path) return undefined;
  if (!basePath || !path.startsWith('/')) return path;
  if (path === basePath || path.startsWith(`${basePath}/`)) return path;
  return `${basePath}${path}`;
}
