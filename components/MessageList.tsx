import React, { useEffect, useRef, useState } from 'react';
import { Message } from '../types';
import { ICONS } from '../constants';
import { ReportDisplay } from './audit/ReportDisplay';
import { HybridMessageBody } from './genui/HybridMessageBody';
import { fallbackAnswerLine } from '../services/llm/fallbackAnswer';
import { gateReportText, looksLikeAuditReport } from '../services/audit/reportColumnGate';
import { LIVE_ANSWER_CHECKS } from '../services/marketing/engineCoverage';

export interface Starter {
  label: string;
  query: string;
}

interface MessageListProps {
  messages: Message[];
  isThinking?: boolean;
  activeTool?: { name: string; stage: string; output?: string } | null;
  onSimplify?: (content: string) => void;
  /** What the agent is doing right now, shown as the live step of the current turn. */
  agentStep?: string | null;
  onStop?: () => void;
  /** Starting questions offered on an empty thread. */
  starters?: Starter[];
  onStarter?: (query: string) => void;
}

/**
 * The text of a chat message as the list shows it, copies it and sends it to be
 * rewritten. An audit written by the model goes through the report gate first.
 * Any other message is returned as written.
 */
export function chatMessageText(msg: Pick<Message, 'role' | 'content'>): string {
  return msg.role === 'model' && looksLikeAuditReport(msg.content)
    ? gateReportText(msg.content)
    : msg.content;
}

function clock(ms: number): string {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function toolInput(exec: NonNullable<Message['toolExecutions']>[number]): string {
  if (exec.code) return exec.code;
  if (Array.isArray(exec.args?.queries)) return exec.args.queries.map((q: string) => `“${q}”`).join(', ');
  return exec.args?.query ? String(exec.args.query) : exec.tool ?? '';
}

function hostOf(uri: string): string {
  try {
    return new URL(uri).hostname.replace(/^www\./, '');
  } catch {
    return uri;
  }
}

const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
);

/** Ask, as a ledger: every turn is a dated row; an answer shows its steps, its sources and how it can fail. */
const MessageList: React.FC<MessageListProps> = ({
  messages, isThinking, activeTool, onSimplify, agentStep, onStop, starters, onStarter,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking, activeTool, agentStep]);

  const handleCopy = (text: string, id: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => {
      // Clipboard is unavailable on insecure origins or when permission is denied.
    });
  };

  // What the agent is doing now: the running tool, else the step the app reported.
  const liveStep = isThinking && (activeTool || agentStep) ? (activeTool ? `${activeTool.name}: ${activeTool.stage}` : agentStep) : null;

  return (
    <div className="lg-thread">
      <div className="lg-thread-in">
        {messages.length === 0 && (
          <section className="lg-empty" aria-labelledby="ask-empty-h">
            <h1 id="ask-empty-h">Ask about your site, your rivals, or what AI says about you.</h1>
            <p>Paste your website address to start. Every answer shows the steps it took and the sources it read. {LIVE_ANSWER_CHECKS}</p>
            {starters && starters.length > 0 && onStarter && (
              <div className="lg-starters" aria-label="Ways to start">
                {starters.map((s) => (
                  <button key={s.label} type="button" className="lg-chip" onClick={() => onStarter(s.query)} disabled={isThinking}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {messages.map((msg, index) => {
          const isLastMessage = index === messages.length - 1;
          const showStreamingIndicator = Boolean(isThinking && isLastMessage && msg.role === 'model');
          const isError = msg.role === 'model' && Boolean(msg.isError);
          // Say who wrote it: a reply from the Worker's fallback model is labelled with that model.
          const fallbackLine = msg.role === 'model' && !isError ? fallbackAnswerLine(msg.fallback) : null;
          const shownContent = chatMessageText(msg);
          const isUser = msg.role === 'user';

          if (isUser) {
            return (
              <div key={msg.id} className="lg-turn">
                <div className="lg-who"><b>You</b><span className="lg-mono">{clock(msg.timestamp)}</span></div>
                <div className="lg-turn-body"><div className="lg-you">{msg.displayContent ?? msg.content}</div></div>
              </div>
            );
          }

          // Only route to the structured report viewer once the stream has finished;
          // a half-streamed table would otherwise flicker between renderers.
          const isAuditReport = !showStreamingIndicator && msg.content.includes('# ') &&
            (msg.content.includes('Visibility Radar') || msg.content.includes('Strategic Intelligence Report') || msg.content.includes('Diagnostic Scan') || msg.content.includes('Competitor Reality Map'));
          const execs = msg.toolExecutions ?? [];

          return (
            <div key={msg.id} className="lg-turn">
              <div className="lg-who"><b>Luminara</b><span className="lg-mono">{clock(msg.timestamp)}</span></div>
              <div className="lg-turn-body">
                {execs.length > 0 && (
                  <details className="lg-trail">
                    <summary>
                      <b>{execs.length} {execs.length === 1 ? 'step' : 'steps'}</b>
                      <span>Show work</span>
                      <ICONS.ChevronDown />
                    </summary>
                    <ol className="lg-steps">
                      {execs.map((exec, i) => {
                        const execId = `${msg.id}-exec-${i}`;
                        return (
                          <li key={execId} className="lg-step">
                            <span className="lg-st lg-st--done"><Check /></span>
                            <div>
                              <div className="lg-step-t">{exec.tool === 'execute_python' ? 'Ran a calculation' : 'Searched the web'}</div>
                              <div className="lg-step-d">{toolInput(exec)}</div>
                              {exec.output && (
                                <details>
                                  <summary className="lg-step-d" style={{ cursor: 'pointer', marginTop: 4 }}>What came back</summary>
                                  <pre className="lg-step-out">{exec.output}</pre>
                                  <button type="button" className="lg-btn lg-btn--ghost lg-btn--sm" onClick={() => handleCopy(exec.output, execId)}>
                                    {copiedId === execId ? 'Copied' : 'Copy'}
                                  </button>
                                </details>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </details>
                )}

                {isError ? (
                  <div className="lg-fail" role="alert">
                    <b><ICONS.AlertCircle />Could not answer</b>
                    <div className="lg-answer">{msg.content}</div>
                    <p>Nothing was saved or sent. Check your AI keys or try again.</p>
                    <div className="lg-turn-tools">
                      <button type="button" className="lg-btn lg-btn--sm" onClick={() => window.dispatchEvent(new CustomEvent('luminara-open-settings'))}>
                        Open Settings and AI keys
                      </button>
                      <button type="button" className="lg-btn lg-btn--ghost lg-btn--sm" onClick={() => window.dispatchEvent(new CustomEvent('luminara-open-native-hub'))}>
                        Set up local engines
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {fallbackLine && <p role="note" className="lg-step-d" style={{ margin: 0 }}>{fallbackLine}</p>}
                    <div className="lg-answer">
                      {isAuditReport ? (
                        // The report screen gates the text itself. It gets the stored text so the
                        // ship commitment saved against that text still unlocks the report.
                        <ReportDisplay markdownText={msg.content} sources={msg.groundingUrls} />
                      ) : (
                        <HybridMessageBody content={shownContent} isStreaming={showStreamingIndicator} />
                      )}
                    </div>
                  </>
                )}

                {showStreamingIndicator && (
                  <p className="lg-step-d" role="status" style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="lg-dot" style={{ background: 'var(--lg-gold)', animation: 'lg-blink 1.2s infinite' }} aria-hidden="true" />
                    Writing the answer
                  </p>
                )}

                {msg.groundingUrls && msg.groundingUrls.length > 0 && !msg.content.includes('Visibility Radar') && (
                  <div className="lg-sources">
                    <span className="lg-label">Sources</span>
                    <ol>
                      {msg.groundingUrls.map((url, idx) => (
                        <li key={`${url.uri}-${idx}`}>
                          <a className="lg-src" href={url.uri} target="_blank" rel="noopener noreferrer" title={url.title || url.uri}>
                            <b>{idx + 1}</b><span>{url.title ? `${hostOf(url.uri)} · ${url.title}` : hostOf(url.uri)}</span>
                          </a>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {!isError && !showStreamingIndicator && (
                  <div className="lg-turn-tools">
                    <button
                      type="button"
                      className="lg-btn lg-btn--ghost lg-btn--sm"
                      onClick={() => handleCopy(shownContent, msg.id)}
                      aria-label={copiedId === msg.id ? 'Copied' : 'Copy response to clipboard'}
                    >
                      {copiedId === msg.id ? <ICONS.Check /> : <ICONS.Copy />}
                      {copiedId === msg.id ? 'Copied' : 'Copy'}
                    </button>
                    {onSimplify && (
                      <button
                        type="button"
                        className="lg-btn lg-btn--ghost lg-btn--sm"
                        onClick={() => onSimplify(shownContent)}
                        aria-label="Rewrite response in plain English"
                      >
                        <ICONS.FileText />
                        Plain English
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {liveStep && (
          <div className="lg-turn" role="status" aria-live="polite" aria-busy="true">
            <div className="lg-who"><b>Luminara</b><span className="lg-mono">now</span></div>
            <div className="lg-turn-body">
              <div className="lg-trail">
                <ol className="lg-steps" style={{ paddingTop: 10 }}>
                  <li className="lg-step">
                    <span className="lg-st lg-st--run" />
                    <div>
                      <div className="lg-step-t">{liveStep}</div>
                      {activeTool?.name === 'execute_python' && activeTool.output && <pre className="lg-step-out">{activeTool.output}</pre>}
                    </div>
                  </li>
                </ol>
              </div>
              {onStop && (
                <div><button type="button" className="lg-btn lg-btn--sm" onClick={onStop} aria-label="Stop generating"><ICONS.Stop />Stop</button></div>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
};

export default MessageList;
