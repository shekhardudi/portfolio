import type { Metadata } from 'next';
import './globals.css';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { SessionPill } from '@/components/session-pill';
import { Toaster } from '@/components/ui/toaster';
import { SessionProvider } from '@/lib/session/SessionProvider';

export const metadata: Metadata = {
  metadataBase: new URL('https://shekharlabs.com'),
  title: {
    default: 'Shekhar Labs — AI engineering portfolio',
    template: '%s · Shekhar Labs',
  },
  description:
    'Production-grade ML/AI solutions: hybrid search, agentic HR, and multi-agent content generation.',
  openGraph: {
    title: 'Shekhar Labs',
    description: 'AI engineering portfolio with live demos.',
    url: 'https://shekharlabs.com',
    siteName: 'Shekhar Labs',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen flex flex-col antialiased">
        <Toaster>
          <SessionProvider>
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <SiteFooter />
            {/* Floating per-tab session widget. Pinned bottom-right so it
                stays accessible while scrolling but doesn't crowd the
                navbar. Idle state is a tiny dot; lights up when jobs run. */}
            <SessionPill />
          </SessionProvider>
        </Toaster>
      </body>
    </html>
  );
}
