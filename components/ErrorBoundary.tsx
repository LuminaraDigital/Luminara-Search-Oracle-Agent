import React from 'react';

interface Props {
  children: React.ReactNode;
  /** Optional label shown in the fallback so the user knows which panel failed. */
  scope?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time exceptions so one broken panel does not blank the whole app.
 * Wrap each major view with it; the fallback offers a reset that re-mounts the subtree.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.scope ? `:${this.props.scope}` : ''}]`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-lg w-full glass-morphism border border-red-500/30 rounded-3xl p-8 space-y-4 bg-red-950/10">
          <p className="text-[10px] font-black uppercase tracking-[0.4em] text-red-400">
            {this.props.scope ? `${this.props.scope} crashed` : 'Something went wrong'}
          </p>
          <p className="text-sm text-gray-300 leading-relaxed">
            This panel hit an unexpected error. Your other work is safe. You can try reloading just this panel.
          </p>
          <pre className="text-[11px] text-red-300/80 bg-black/60 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap">
            {this.state.error.message}
          </pre>
          <div className="flex gap-3">
            <button
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#BF953F] to-[#AA771C] text-black text-[10px] uppercase font-black tracking-wider"
            >
              Reload panel
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl border border-white/10 text-gray-300 text-[10px] uppercase font-bold tracking-wider hover:text-white"
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
