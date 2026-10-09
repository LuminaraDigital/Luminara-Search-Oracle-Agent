import React, { useEffect } from 'react';

interface Props {
  onHome: () => void;
}

export const NotFoundPage: React.FC<Props> = ({ onHome }) => {
  useEffect(() => {
    document.title = '404 - Page Not Found | Luminara Suite';
  }, []);

  return (
    <div className="min-h-screen bg-black text-gray-300 flex flex-col items-center justify-center px-6 py-12 selection:bg-gold/30">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/10 text-gold mb-2">
          <span className="text-2xl font-mono font-bold">404</span>
        </div>
        <h1 className="text-3xl font-display font-semibold text-white tracking-tight">
          Page Not Found
        </h1>
        <p className="text-sm text-gray-400 leading-relaxed">
          The requested page does not exist or has moved. Every URL is handled honestly.
        </p>
        <div className="pt-2">
          <button
            type="button"
            onClick={onHome}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black text-xs font-bold uppercase tracking-wider hover:opacity-90 active:scale-95 transition-all shadow-lg shadow-gold/20"
          >
            Return Home
          </button>
        </div>
      </div>
    </div>
  );
};
