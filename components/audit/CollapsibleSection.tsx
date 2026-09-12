import React, { useState } from 'react';
import { ICONS } from '../../constants';

export const CollapsibleSection: React.FC<{
  title: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  isMainTitle?: boolean;
}> = ({ title, children, defaultOpen = true, isMainTitle = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (isMainTitle) {
    return <div className="mb-6">{children}</div>;
  }

  return (
    <div className="mb-4 glass-morphism rounded-xl border border-white/10 overflow-hidden shadow-lg transition-all duration-300 hover:border-gold/40">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-6 py-4 text-left bg-gradient-to-r from-black/60 via-black/40 to-transparent hover:from-gold/10 transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none group"
      >
        <h2 className="text-base font-bold text-white flex items-center gap-2 group-hover:text-gold-light transition-colors uppercase tracking-wider">
          {title}
        </h2>
        <div className={`text-gold transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>
          <ICONS.ChevronDown className="w-4 h-4" />
        </div>
      </button>
      <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isOpen ? 'max-h-[3500px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="px-6 py-5 border-t border-white/5 text-sm text-gray-300 leading-relaxed">
          {children}
        </div>
      </div>
    </div>
  );
};
