import type { Metadata } from 'next';
import './globals.css';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Toaster } from '@/components/ui/toaster';

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
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </Toaster>
      </body>
    </html>
  );
}
