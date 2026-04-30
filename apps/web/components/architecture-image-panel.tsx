'use client';

import { useState } from 'react';

interface Props {
  src: string;
  alt: string;
}

export function ArchitectureImagePanel({ src, alt }: Props) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-[#f8f4e8] p-3">
      {!failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          onError={() => setFailed(true)}
          className="mx-auto h-auto max-h-[760px] w-full rounded-lg border border-border object-contain bg-[#f8f4e8]"
        />
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-[#f8f4e8] p-8 text-center text-sm text-foreground/70">
          Architecture image not found at: {src}
        </div>
      )}
    </div>
  );
}
