import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || 'An unexpected application error occurred.',
    };
  }

  render() {
    if (this.state.hasError) {
      let displayMsg = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message) as {
          error?: string;
          operationType?: string;
          path?: string;
        };
        if (parsed.error) {
          displayMsg = `${parsed.error} (${parsed.operationType || 'operation'} on ${parsed.path || 'database'})`;
        }
      } catch {
        // Keep plain message
      }

      return (
        <div className="min-h-screen bg-[#000000] text-[#F5F5F5] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-[#181818] border border-[#272727] rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="heading-6 text-white">Application error</h2>
            </div>
            <p className="body-6 text-[#A3A3A3] break-words">{displayMsg}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#F5F5F5] text-[#000000] button-sm hover:bg-white transition-colors duration-300"
            >
              <RotateCcw className="w-4 h-4" />
              Reload workspace
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
