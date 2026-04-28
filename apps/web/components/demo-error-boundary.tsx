'use client';

import * as React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  error: Error | null;
}

/**
 * Catches render errors inside a single Demo so a busted plugin doesn't blow
 * up the rest of the page. Shows a small recovery card with a Retry button
 * that resets the error and re-mounts children.
 */
export class DemoErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[DemoErrorBoundary]', error, info);
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-red-400" />
            <div className="flex-1">
              <h4 className="text-sm font-semibold">Demo crashed</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                {this.state.error.message || 'Unknown error rendering this demo.'}
              </p>
              <button
                onClick={this.reset}
                className="mt-3 inline-flex items-center gap-1 rounded-md border border-border px-3 py-1 text-xs hover:bg-muted"
              >
                <RotateCcw className="h-3 w-3" /> retry
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
