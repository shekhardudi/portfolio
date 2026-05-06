import Link from 'next/link';
import { Cpu, Github, Linkedin } from 'lucide-react';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
      <div className="container-tight flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Cpu className="h-5 w-5 text-blue-400" />
          <span>shekharlabs</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm sm:gap-5">
          <Link className="text-foreground/80 hover:text-foreground" href="/#solutions">
            Solutions
          </Link>
          <Link className="text-foreground/80 hover:text-foreground" href="/about">
            About
          </Link>
          <a
            className="text-foreground/60 hover:text-foreground"
            href="https://www.linkedin.com/in/shekhar-dudi-17283717/"
            target="_blank"
            rel="noopener"
            aria-label="LinkedIn"
          >
            <Linkedin className="h-4 w-4" />
          </a>
          <a
            className="text-foreground/60 hover:text-foreground"
            href="https://github.com/shekhardudi"
            target="_blank"
            rel="noopener"
            aria-label="GitHub"
          >
            <Github className="h-4 w-4" />
          </a>
        </nav>
      </div>
    </header>
  );
}
