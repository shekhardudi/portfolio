import Link from 'next/link';
import { Cpu } from 'lucide-react';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
      <div className="container-tight flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Cpu className="h-5 w-5 text-blue-400" />
          <span>shekharlabs</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link className="text-muted-foreground hover:text-foreground" href="/#solutions">
            Solutions
          </Link>
          <Link className="text-muted-foreground hover:text-foreground" href="/about">
            About
          </Link>
          <Link
            className="text-muted-foreground hover:text-foreground"
            href="https://github.com/shekhardudi"
            target="_blank"
            rel="noopener"
          >
            GitHub
          </Link>
        </nav>
      </div>
    </header>
  );
}
