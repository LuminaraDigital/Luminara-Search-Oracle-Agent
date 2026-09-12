import React, { useEffect, useRef, useState } from 'react';
import { Message } from '../types';
import { ICONS } from '../constants';
import { renderMarkdown } from '../utils/markdown';
import { ReportDisplay } from './audit/ReportDisplay';

interface MessageListProps {
  messages: Message[];
  isThinking?: boolean;
  activeTool?: { name: string; stage: string; output?: string } | null;
  onSimplify?: (content: string) => void;
}

const MessageList: React.FC<MessageListProps> = ({ messages, isThinking, activeTool, onSimplify }) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking, activeTool]);

  const handleCopy = (text: string, id: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => {
      // Clipboard is unavailable on insecure origins or when permission is denied.
    });
  };

  return (
    <div className="flex-1 overflow-y-auto px-3 sm:px-6 md:px-8 py-4 sm:py-6 space-y-8 sm:space-y-12">
      {messages.length === 0 && (
        <div className="min-h-full flex flex-col items-center justify-center text-center max-w-5xl mx-auto space-y-12 py-12">
          <div className="w-24 h-24 mb-4">
            <ICONS.LuminaraLogo isThinking={isThinking} className="w-full h-full" />
          </div>
          <div className="space-y-6">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight gold-text pb-2">
              Ask Luminara
            </h1>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto leading-relaxed px-4">
              Ask anything about how your business shows up in Google and AI answers. Paste your website address to start with an audit.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 w-full px-4">
            <div className="p-6 glass-morphism rounded-[24px] text-center border border-gold-500/10 hover:border-gold-500/40 transition-all group">
              <div className="text-3xl font-bold gold-text mb-2">Live</div>
              <div className="text-[9px] text-gold font-black uppercase tracking-[0.2em] mb-3">SERP Grounding</div>
              <div className="text-[10px] text-gray-400 leading-relaxed">Every answer is grounded in real search results when a search key is configured.</div>
            </div>
            
            <div className="p-6 glass-morphism rounded-[24px] text-center border border-gold-500/10 hover:border-gold-500/40 transition-all group">
              <div className="text-3xl font-bold gold-text mb-2">3</div>
              <div className="text-[9px] text-gold font-black uppercase tracking-[0.2em] mb-3">Audit Lenses</div>
              <div className="text-[10px] text-gray-400 leading-relaxed">SEO, AEO and GEO audits with visibility radar, competitor map and schema gaps.</div>
            </div>
            
            <div className="p-6 glass-morphism rounded-[24px] text-center border border-gold-500/10 hover:border-gold-500/40 transition-all group">
              <div className="text-3xl font-bold gold-text mb-2">DNA</div>
              <div className="text-[9px] text-gold font-black uppercase tracking-[0.2em] mb-3">Brand Memory</div>
              <div className="text-[10px] text-gray-400 leading-relaxed">Link your Business DNA once and every audit is personalised to your USP and competitors.</div>
            </div>

            <div className="p-6 glass-morphism rounded-[24px] text-center border border-gold-500/10 hover:border-gold-500/40 transition-all group">
              <div className="text-3xl font-bold gold-text mb-2">Plain</div>
              <div className="text-[9px] text-gold font-black uppercase tracking-[0.2em] mb-3">English Mode</div>
              <div className="text-[10px] text-gray-400 leading-relaxed">One click rewrites any report at an 8th-grade reading level for non-technical stakeholders.</div>
            </div>
          </div>
        </div>
      )}

      {messages.map((msg, index) => {
        const isLastMessage = index === messages.length - 1;
        const showStreamingIndicator = isThinking && isLastMessage && msg.role === 'model';
        
        const isError = msg.role === 'model' && Boolean(msg.isError);

        return (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`w-full ${msg.role === 'user' ? 'max-w-[90%] md:max-w-[75%]' : 'max-w-full'}`}>
              <div className={`flex items-start gap-3 sm:gap-6 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-2xl flex items-center justify-center shadow-xl border ${msg.role === 'user' ? 'bg-surface-2 border-white/10' : 'glass-morphism mt-2 sm:mt-4'}`}>
                  {msg.role === 'user' ? (
                     <span className="text-[9px] font-black text-gray-400 tracking-widest">USR</span>
                  ) : (
                    <ICONS.LuminaraLogo className="w-8 h-8 sm:w-10 sm:h-10" isThinking={showStreamingIndicator} />
                  )}
                </div>
                
                <div className={`flex-1 min-w-0 transition-all duration-500 ${
                  msg.role === 'user' 
                    ? 'p-4 sm:p-6 rounded-[24px] sm:rounded-[28px] bg-surface-2 text-gray-300 border border-white/5 shadow-2xl whitespace-pre-wrap leading-relaxed' 
                    : isError 
                      ? 'p-5 sm:p-8 md:p-10 rounded-[28px] sm:rounded-[40px] bg-danger-950/20 text-danger-200 border border-danger-500/30 shadow-2xl'
                      : 'p-5 sm:p-8 md:p-12 lg:p-14 rounded-[28px] sm:rounded-[44px] glass-morphism border-gold/15 shadow-[0_25px_80px_rgba(0,0,0,0.8)]'
                } ${showStreamingIndicator && msg.role === 'model' ? 'border-gold/40 ring-1 ring-gold/20' : ''}`}>
                  
                  {isError && (
                    <div className="flex items-center gap-3 mb-4 sm:mb-6 text-danger-400">
                      <ICONS.AlertCircle />
                      <span className="text-[10px] font-black uppercase tracking-[0.4em]">Strategic Breach Intercepted</span>
                    </div>
                  )}

                  <div className="flex justify-end gap-2 mb-2">
                    {msg.role === 'model' && !isError && onSimplify && (
                      <button
                        type="button"
                        onClick={() => onSimplify(msg.content)}
                        className="p-1.5 rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:text-gold hover:border-gold/30 transition-all flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold outline-none focus-visible:ring-2 focus-visible:ring-gold"
                        title="Rewrite this in plain English"
                        aria-label="Rewrite response in plain English"
                      >
                        <ICONS.FileText />
                        <span>Plain English</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleCopy(msg.content, msg.id)}
                      className="p-1.5 rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:text-gold hover:border-gold/30 transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold"
                      title="Copy"
                      aria-label={copiedId === msg.id ? "Copied" : "Copy response to clipboard"}
                    >
                      {copiedId === msg.id ? <ICONS.Check className="text-success-400" /> : <ICONS.Copy />}
                    </button>
                  </div>
                  
                  {msg.toolExecutions && msg.toolExecutions.length > 0 && (
                    <div className="mb-12 space-y-6">
                      {msg.toolExecutions.map((exec, i) => {
                        const execId = `${msg.id}-exec-${i}`;
                        return (
                          <div key={i} className="rounded-2xl overflow-hidden border border-gold/20 bg-black/60 shadow-inner">
                            <div className="bg-gold/5 px-6 py-3 flex items-center justify-between border-b border-gold/10">
                              <div className="flex items-center gap-4">
                                <span className="text-[9px] font-black uppercase tracking-[0.3em] text-gold">Grounding SERP</span>
                              </div>
                              <button 
                                type="button"
                                onClick={() => handleCopy(exec.output, execId)}
                                aria-label={copiedId === execId ? "Copied" : "Copy search output"}
                                className="text-[9px] font-bold uppercase tracking-widest px-4 py-1.5 rounded-lg border border-gold/20 bg-gold/5 text-gold-light hover:text-gold hover:border-gold/50 transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold"
                              >
                                {copiedId === execId ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                            <div className="p-6 font-mono text-[12px] space-y-4">
                              <div className="text-info-400 bg-info-500/10 p-3 rounded-xl border border-info-500/20">
                                <span className="text-gray-400 mr-3">&gt;&gt;</span>{exec.code ?? (Array.isArray(exec.args?.queries) ? `Searched: ${exec.args.queries.map((q: string) => `"${q}"`).join(', ')}` : exec.tool ? `${exec.tool}(${exec.args?.query ?? ''})` : '')}
                              </div>
                              <div className="text-gray-300 pt-3 whitespace-pre leading-relaxed border-t border-white/5">
                                {exec.output}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {msg.role === 'model' ? (
                    (() => {
                      // Only route to the structured report viewer once the stream has finished;
                      // a half-streamed table would otherwise flicker between renderers.
                      const isAuditReport = !showStreamingIndicator && msg.content.includes('# ') && 
                        (msg.content.includes('Visibility Radar') || msg.content.includes('Strategic Intelligence Report') || msg.content.includes('Diagnostic Scan') || msg.content.includes('Competitor Reality Map'));

                      if (isAuditReport) {
                        return <ReportDisplay markdownText={msg.content} sources={msg.groundingUrls} />;
                      }

                      return (
                        <div 
                          className="markdown-content prose prose-invert max-w-none"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                        />
                      );
                    })()
                  ) : (
                    msg.content
                  )}

                  {isError && (
                    <div className="mt-6 pt-4 border-t border-danger-500/20 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => window.dispatchEvent(new CustomEvent('luminara-open-settings'))}
                        className="px-4 py-2 rounded-xl bg-gold/20 hover:bg-gold/30 border border-gold/40 text-gold-light text-xs font-mono font-bold uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                      >
                        <ICONS.Settings className="w-3.5 h-3.5 text-gold" />
                        <span>Open Settings &amp; AI Keys</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => window.dispatchEvent(new CustomEvent('luminara-open-native-hub'))}
                        className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-gray-300 hover:text-white text-xs font-mono font-bold transition-all flex items-center gap-2 cursor-pointer"
                      >
                        <span>⚡ Configure Native Engines</span>
                      </button>
                    </div>
                  )}

                  {showStreamingIndicator && (
                    <div className="mt-8 flex flex-col gap-4">
                      <div className="flex items-center gap-4">
                        <span className="streaming-cursor" />
                        <span className="text-[11px] text-gold uppercase tracking-[0.4em] font-black animate-pulse">Working on it…</span>
                      </div>
                      <div className="w-48 h-[1px] bg-gradient-to-r from-gold/40 via-transparent to-transparent"></div>
                    </div>
                  )}

                  {msg.groundingUrls && msg.groundingUrls.length > 0 && !msg.content.includes('Visibility Radar') && (
                    <div className="mt-16 pt-12 border-t border-gold/10 space-y-8">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-black text-gold uppercase tracking-[0.4em]">Sources</p>
                        <div className="w-12 h-1px bg-gold/30"></div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {msg.groundingUrls.map((url, idx) => (
                          <a
                            key={idx}
                            href={url.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group p-5 rounded-2xl bg-white/5 hover:bg-gold/10 border border-white/5 hover:border-gold/30 transition-all flex flex-col gap-2 outline-none focus-visible:ring-2 focus-visible:ring-gold"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] text-gold font-bold">[{idx + 1}]</span>
                              <div className="w-2 h-2 rounded-full bg-gold/20 group-hover:bg-gold transition-colors"></div>
                            </div>
                            <span className="text-[13px] font-medium text-gray-200 group-hover:text-gold-light transition-colors line-clamp-1">
                              {url.title || url.uri}
                            </span>
                            <span className="text-[10px] text-gray-400 font-mono truncate">{url.uri}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {activeTool && (
        <div className="flex justify-start ml-24 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex flex-col gap-4 max-w-[80%]">
            <div className="flex items-center gap-6 px-8 py-5 rounded-[24px] glass-morphism border border-gold/30 shadow-2xl self-start overflow-hidden relative">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-gold/5 to-transparent animate-[shimmer_3s_infinite] pointer-events-none" />
              
              <div className="relative w-4 h-4">
                <div className="absolute inset-0 rounded-full bg-gold animate-pulse"></div>
                <div className="absolute inset-0 rounded-full bg-gold animate-ping opacity-20"></div>
              </div>
              <div className="flex flex-col gap-1 relative z-10">
                <div className="flex items-center gap-4">
                  <span className="text-[12px] font-black text-gold-light uppercase tracking-[0.4em]">{activeTool.name}</span>
                  <div className="h-2 w-px bg-white/20"></div>
                  <span className="text-[9px] text-gray-600 font-mono">{activeTool.name.toUpperCase()}</span>
                </div>
                <span className="text-[11px] text-gold/80 font-bold uppercase tracking-[0.2em]">{activeTool.stage}</span>
              </div>
            </div>
            
            {activeTool.name === 'execute_python' && activeTool.output && (
              <div className="bg-black/80 border border-gold/20 rounded-2xl p-6 font-mono text-[11px] text-gray-500 shadow-3xl animate-in zoom-in-95 border-l-4 border-l-gold">
                <div className="flex items-center gap-3 mb-4 text-gold/40 uppercase tracking-[0.3em] font-black text-[9px]">
                  Oracle Agent Kernel Matrix Stream
                </div>
                <div className="whitespace-pre overflow-hidden leading-relaxed opacity-70 border-l border-white/5 pl-4">
                  {activeTool.output}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div ref={bottomRef} className="h-20" />
    </div>
  );
};

export default MessageList;
