import React from 'react';
import { GLOSSARY } from '../../constants';
import { splitWikiParts } from '../../services/audit/wikiLinkService';

// Highlighted text component with interactive glossary tooltip
export const HighlightedText: React.FC<{ text: string }> = ({ text }) => {
  const terms = Object.keys(GLOSSARY);
  const pattern = new RegExp(`\\b(${terms.join('|')})\\b`, 'gi');

  const renderGlossary = (segment: string, keyPrefix: string) => {
    const parts = segment.split(pattern);
    return parts.map((part, index) => {
      const upperPart = part.toUpperCase();
      const definition = GLOSSARY[upperPart];
      if (definition) {
        return (
          <span key={`${keyPrefix}-${index}`} className="group relative inline-block cursor-help text-gold-light border-b border-dotted border-gold/60 hover:text-white transition-colors">
            {part}
            <span className="invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all duration-300 absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 glass-morphism border border-gold/40 text-gray-200 text-xs rounded-xl p-3 shadow-2xl z-50 whitespace-normal pointer-events-none bg-black/95">
              <strong className="block mb-1 text-gold-light font-bold uppercase tracking-wider text-[10px]">{upperPart}</strong>
              {definition}
            </span>
          </span>
        );
      }
      return <React.Fragment key={`${keyPrefix}-${index}`}>{part}</React.Fragment>;
    });
  };

  const wikiParts = splitWikiParts(text);
  return (
    <>
      {wikiParts.map((wp, i) => {
        if (wp.type === 'wiki') {
          return (
            <button
              key={`wiki-${i}`}
              type="button"
              title={`Competitor: ${wp.value}`}
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('luminara-open-brand-memory', { detail: { competitor: wp.value } })
                );
              }}
              className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-md bg-gold/15 border border-gold/40 text-gold-light text-[11px] font-semibold hover:bg-gold/25 transition-colors"
            >
              [[{wp.value}]]
            </button>
          );
        }
        return <React.Fragment key={`t-${i}`}>{renderGlossary(wp.value, `g-${i}`)}</React.Fragment>;
      })}
    </>
  );
};

export const parseInlineFormatting = (line: string): React.ReactElement => {
  const parts = line.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={index} className="font-semibold text-white"><HighlightedText text={part.slice(2, -2)} /></strong>;
        }
        if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
          return <em key={index} className="text-gray-300 italic"><HighlightedText text={part.slice(1, -1)} /></em>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={index} className="bg-black/60 text-gold-light rounded px-1.5 py-0.5 text-xs font-mono border border-white/10">{part.slice(1, -1)}</code>;
        }
        return <span key={index}><HighlightedText text={part} /></span>;
      })}
    </>
  );
};
