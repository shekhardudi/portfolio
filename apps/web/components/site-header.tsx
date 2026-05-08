'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Cpu, Github, Linkedin, Menu } from 'lucide-react';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';

export function SiteHeader() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
      <div className="container-tight flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Cpu className="h-5 w-5 text-blue-400" />
          <span>shekharlabs</span>
        </Link>

        <nav className="hidden items-center gap-4 text-sm sm:flex sm:gap-5">
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

        <div className="sm:hidden">
          {!mounted ? (
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md border border-border bg-background/70 p-2 text-foreground/85"
              aria-label="Open navigation"
              disabled
            >
              <Menu className="h-4 w-4" />
            </button>
          ) : (
            <Drawer>
              <DrawerTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-md border border-border bg-background/70 p-2 text-foreground/85"
                  aria-label="Open navigation"
                >
                  <Menu className="h-4 w-4" />
                </button>
              </DrawerTrigger>
              <DrawerContent side="right" className="w-[85vw] max-w-[320px]">
                <DrawerHeader>
                  <DrawerTitle>Navigation</DrawerTitle>
                  <DrawerDescription>Browse portfolio sections</DrawerDescription>
                </DrawerHeader>
                <nav className="mt-2 flex flex-col gap-1 text-sm">
                  <Link
                    href="/#solutions"
                    className="rounded-md px-2 py-2 text-foreground/85 hover:bg-muted"
                  >
                    Solutions
                  </Link>
                  <Link
                    href="/about"
                    className="rounded-md px-2 py-2 text-foreground/85 hover:bg-muted"
                  >
                    About
                  </Link>
                  <a
                    className="rounded-md px-2 py-2 text-foreground/80 hover:bg-muted"
                    href="https://www.linkedin.com/in/shekhar-dudi-17283717/"
                    target="_blank"
                    rel="noopener"
                  >
                    LinkedIn
                  </a>
                  <a
                    className="rounded-md px-2 py-2 text-foreground/80 hover:bg-muted"
                    href="https://github.com/shekhardudi"
                    target="_blank"
                    rel="noopener"
                  >
                    GitHub
                  </a>
                </nav>
              </DrawerContent>
            </Drawer>
          )}
        </div>
      </div>
    </header>
  );
}
