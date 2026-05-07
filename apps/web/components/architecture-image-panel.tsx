'use client';

import { useState } from 'react';

interface Props {
  src: string;
  alt: string;
}

export function ArchitectureImagePanel({ src, alt }: Props) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="bg-background py-2">
      {!failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          onError={() => setFailed(true)}
          className="mx-auto h-auto max-h-[72vh] w-full object-contain bg-background"
        />
      ) : (
        <div className="min-h-[72vh] border border-dashed border-border bg-background p-8 text-center text-sm text-foreground/70">
          Architecture image not found at: {src}
        </div>
      )}
    </div>
  );
}
