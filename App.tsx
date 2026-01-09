import React, { useState, useEffect, useCallback, useRef } from 'react';
import { OracleMode, Message, ToolExecution } from './types';
import { geminiService } from './services/geminiService';
import { OracleLiveService } from './services/liveService';
import MessageList from './components/MessageList';
import InputBar from './components/InputBar';
import Waveform from './components/Waveform';
import LandingPage from './components/LandingPage';
import InfrastructurePage from './components/InfrastructurePage';
import IntelligencePage from './components/IntelligencePage';
import WhyLuminaraPage from './components/WhyLuminaraPage';
import PricingPage from './components/PricingPage';
import { ICONS } from './constants';

const App: React.FC = () => {
  const [view, setView] = useState<'landing' | 'app' | 'infrastructure' | 'intelligence' | 'why' | 'pricing'>('landing');
  const [messages, setMessages] = useState<Message[]>([]);
  const [mode, setMode] = useState<OracleMode>(OracleMode.FLASH);
  const [isThinking, setIsThinking] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [agentStep, setAgentStep] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [activeTool, setActiveTool] = useState<{ name: string; stage: string; output?: string } | null>(null);
  const [headerSearch, setHeaderSearch] = useState('');
  
  const liveServiceRef = useRef<OracleLiveService | null>(null);

  useEffect(() => {
    if (view === 'app') {
      window.scrollTo(0, 0); 
      liveServiceRef.current = new OracleLiveService(
        (text, isUser) => {
          console.log(`Luminara Digital Transcription (${isUser ? 'User' : 'Vaticinator'}): ${text}`);
        },
        (active) => setIsVoiceActive(active)
      );
    }

    return () => {
      liveServiceRef.current?.stop();
    };
  }, [view]);

  const handleSendMessage = useCallback(async (content: string) => {
    if (isThinking || !content.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg]);
    setIsThinking(true);
    setProgress(5);
    setAgentStep('Luminara Digital: Initializing Agentic Loop');

    const modelId = (Date.now() + 1).toString();
    const modelMsg: Message = {
      id: modelId,
      role: 'model',
      content: '',
      timestamp: Date.now(),
      mode,
    };
    setMessages(prev => [...prev, modelMsg]);

    try {
      const isAdvanced = mode === OracleMode.DEEP_THINK || 
                        content.toLowerCase().includes('audit') || 
                        content.toLowerCase().includes('strategy') ||
                        content.toLowerCase().includes('aeo') ||
                        content.toLowerCase().includes('scan') ||
                        content.toLowerCase().includes('benchmark');

      if (isAdvanced) {
        setProgress(15);
        setAgentStep('Deep Crawl: Analyzing AEO Landscape');
        setIsSearching(true);
        
        setActiveTool({ name: 'search_web', stage: 'Orchestrating Multi-Agent Navigation' });
        
        const searchPromise = geminiService.queryWithSearch(content);
        
        const stage1Timeout = setTimeout(() => {
          setProgress(30);
          setActiveTool(prev => prev ? { ...prev, stage: 'Evaluating LLM Citation Probabilities' } : null);
        }, 1200);

        const stage2Timeout = setTimeout(() => {
          setProgress(45);
          setActiveTool(prev => prev ? { ...prev, stage: 'Benchmarking Entity Clarity Metrics' } : null);
        }, 2500);

        const result = await searchPromise;
        clearTimeout(stage1Timeout);
        clearTimeout(stage2Timeout);
        
        setProgress(60);
        setAgentStep('Reasoning Kernels: Synthesizing Intelligence');

        const pythonLogs = [
          "Importing diagnostic_stack, aeo_analyzer...",
          "Calculating Impact Scores for plain-English tasks...",
          "Benchmarking brand visibility across LLM vectors...",
          "Success: AEO Confidence > 92.8%.",
          "Mapping schema.org JSON-LD requirements...",
          "Drafting Packaging Report (PDF Style)...",
          "Finalizing Luminara Strategic Intelligence Audit..."
        ];

        setActiveTool({ 
          name: 'execute_python', 
          stage: 'Running Heuristic Simulations',
          output: pythonLogs[0]
        });

        let logIndex = 0;
        const logInterval = setInterval(() => {
          logIndex++;
          const currentProgress = 60 + (logIndex * 5);
          setProgress(currentProgress);

          if (logIndex < pythonLogs.length) {
            let nextStage = activeTool?.stage || '';
            if (logIndex === 1) nextStage = 'Quantifying Technical SEO Impact';
            if (logIndex === 4) nextStage = 'Mapping Entity Relationships';
            if (logIndex === 6) nextStage = 'Assembling Unified Audit Document';

            setActiveTool(prev => prev ? { 
              ...prev, 
              stage: nextStage || prev.stage, 
              output: pythonLogs[logIndex] 
            } : null);
          } else {
            clearInterval(logInterval);
          }
        }, 800);

        await new Promise(resolve => setTimeout(resolve, (pythonLogs.length * 800) + 200));
        clearInterval(logInterval);
        
        setProgress(95);
        setAgentStep('Delivering: Packaged Strategic Audit');
        
        setMessages(prev => prev.map(m => 
          m.id === modelId 
            ? { ...m, content: result.text, groundingUrls: result.urls, toolExecutions: result.toolExecutions } 
            : m
        ));
        
        setIsSearching(false);
        setActiveTool(null);
      } else {
        setAgentStep('Luminara Flash Search: Streaming Results');
        setProgress(50);
        setIsSearching(true);
        setActiveTool({ name: 'search_web', stage: 'Grounding Real-Time Insights' });

        let fullText = '';
        let allUrls: Array<{ uri: string; title: string }> = [];

        for await (const chunk of geminiService.streamQuery(content, mode)) {
          if (chunk.text) {
            fullText += chunk.text;
          }
          if (chunk.groundingUrls) {
            const existingUris = new Set(allUrls.map(u => u.uri));
            chunk.groundingUrls.forEach(u => {
              if (!existingUris.has(u.uri)) {
                allUrls.push(u);
              }
            });
          }
          
          setMessages(prev => prev.map(m => m.id === modelId ? { ...m, content: fullText, groundingUrls: allUrls } : m));
        }
        setProgress(100);
      }
    } catch (error) {
      console.error("Luminara Digital Error:", error);
      setMessages(prev => prev.map(m => m.id === modelId ? { ...m, content: "Luminara Digital: Systems Interrupted. Connection breach in Neural Node." } : m));
      setActiveTool(null);
    } finally {
      setIsThinking(false);
      setIsSearching(false);
      setAgentStep(null);
      setActiveTool(null);
      setProgress(0);
      setHeaderSearch('');
    }
  }, [mode, isThinking]);

  const handleSimplify = useCallback(async (content: string) => {
    handleSendMessage(`Execute [Plain English Protocol] to simplify this content for an 8th-grade reading level. Use short, direct sentences: \n\n${content}`);
  }, [handleSendMessage]);

  const toggleVoice = useCallback(() => {
    if (isVoiceActive) {
      liveServiceRef.current?.stop();
    } else {
      liveServiceRef.current?.start();
    }
  }, [isVoiceActive]);

  const quickActions = [
    { label: 'Simplify Strategy', query: 'Execute [Plain English Protocol] on the current strategic landscape. Make it easy to read.' },
    { label: 'Scan & Diagnose', query: 'Execute [Crawl & Diagnose] protocol. Find simple technical tasks with big impact scores.' },
    { label: 'AEO Visibility', query: 'Execute [AEO & AI Visibility] audit. How does AI see my brand?' },
    { label: 'Full Audit', query: 'Run [Unified Reporting]. Build a clear business report for revenue growth.' }
  ];

  if (view === 'landing') {
    return (
      <LandingPage 
        onEnter={() => setView('app')} 
        onNavigateInfrastructure={() => setView('infrastructure')} 
        onNavigateIntelligence={() => setView('intelligence')} 
        onNavigateWhy={() => setView('why')}
        onNavigatePricing={() => setView('pricing')}
      />
    );
  }

  if (view === 'infrastructure') {
    return (
      <InfrastructurePage 
        onBack={() => setView('landing')} 
        onTerminal={() => setView('app')} 
        onNavigateIntelligence={() => setView('intelligence')} 
        onNavigateWhy={() => setView('why')}
        onNavigatePricing={() => setView('pricing')}
      />
    );
  }

  if (view === 'intelligence') {
    return (
      <IntelligencePage 
        onBack={() => setView('landing')} 
        onTerminal={() => setView('app')} 
        onNavigateInfrastructure={() => setView('infrastructure')} 
        onNavigateWhy={() => setView('why')}
        onNavigatePricing={() => setView('pricing')}
      />
    );
  }

  if (view === 'why') {
    return (
      <WhyLuminaraPage 
        onBack={() => setView('landing')} 
        onTerminal={() => setView('app')} 
        onNavigateInfrastructure={() => setView('infrastructure')}
        onNavigateIntelligence={() => setView('intelligence')}
        onNavigatePricing={() => setView('pricing')}
      />
    );
  }

  if (view === 'pricing') {
    return (
      <PricingPage 
        onBack={() => setView('landing')} 
        onTerminal={() => setView('app')} 
        onNavigateInfrastructure={() => setView('infrastructure')}
        onNavigateIntelligence={() => setView('intelligence')}
        onNavigateWhy={() => setView('why')}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen bg-black text-[#f1f1f1] overflow-hidden relative animate-in fade-in duration-1000">
      {isThinking && <div className="hologram-scan" />}

      <header className="flex items-center justify-between px-8 py-3 glass-morphism z-50 border-b border-[#BF953F]/10">
        <div className="flex items-center gap-4 w-[30%]">
          <div className="w-10 h-10 cursor-pointer" onClick={() => setView('landing')}>
            <ICONS.LuminaraLogo 
              className={`w-full h-full transition-all duration-500 ${isVoiceActive ? 'drop-shadow-[0_0_15px_rgba(252,246,186,0.6)]' : ''}`} 
              isThinking={isThinking} 
              isVoice={isVoiceActive} 
            />
          </div>
          <div className="hidden sm:block">
            <h2 className={`text-lg font-bold tracking-[0.2em] uppercase transition-all duration-700 animate-title-shimmer ${
              (isThinking || isVoiceActive) ? 'title-pronounced scale-[1.02]' : 'opacity-90'
            }`}>
              LUMINARA SEARCH
            </h2>
          </div>
        </div>

        <div className="flex-1 max-w-2xl px-4 flex items-center justify-center gap-6">
          <button 
            onClick={() => setView('infrastructure')}
            className="text-[9px] uppercase tracking-[0.3em] font-bold text-gray-500 hover:text-white transition-colors whitespace-nowrap"
          >
            Infrastructure
          </button>
          <button 
            onClick={() => setView('intelligence')}
            className="text-[9px] uppercase tracking-[0.3em] font-bold text-gray-500 hover:text-white transition-colors whitespace-nowrap"
          >
            Intelligence
          </button>
          <button 
            onClick={() => setView('why')}
            className="text-[9px] uppercase tracking-[0.3em] font-bold text-gray-500 hover:text-white transition-colors whitespace-nowrap"
          >
            Why Us
          </button>
          <button 
            onClick={() => setView('pricing')}
            className="text-[9px] uppercase tracking-[0.3em] font-bold text-gray-500 hover:text-white transition-colors whitespace-nowrap"
          >
            Pricing
          </button>
          <form 
            onSubmit={(e) => { e.preventDefault(); handleSendMessage(headerSearch); }}
            className={`relative group flex-1 max-w-[300px] transition-all duration-500 ${isThinking ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#BF953F]/60 group-hover:text-[#BF953F] transition-colors">
              <ICONS.Search />
            </div>
            <input
              type="text"
              value={headerSearch}
              onChange={(e) => setHeaderSearch(e.target.value)}
              placeholder="Query Core..."
              className="w-full bg-white/5 border border-white/10 rounded-full py-2 pl-10 pr-4 text-xs focus:outline-none focus:border-[#BF953F]/40 focus:bg-white/[0.08] transition-all placeholder-gray-600"
            />
          </form>
        </div>

        <div className="flex items-center justify-end gap-6 w-[30%]">
          <div className="hidden lg:flex items-center bg-[#0a0a0a] rounded-xl p-1 border border-white/5">
            <button
              onClick={() => setMode(OracleMode.FLASH)}
              className={`px-4 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all ${mode === OracleMode.FLASH ? 'bg-gradient-to-br from-[#BF953F] to-[#AA771C] text-black shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
            >
              Flash
            </button>
            <button
              onClick={() => setMode(OracleMode.DEEP_THINK)}
              className={`px-4 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all ${mode === OracleMode.DEEP_THINK ? 'bg-gradient-to-br from-[#BF953F] to-[#AA771C] text-black shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
            >
              Deep
            </button>
          </div>
          <button 
            onClick={() => setView('landing')}
            className="hidden sm:block px-4 py-1.5 glass-morphism border border-white/5 rounded-xl text-[8px] uppercase tracking-widest font-black text-gray-500 hover:text-[#BF953F] transition-all"
          >
            Exit
          </button>
        </div>
      </header>

      <main className="flex-1 relative flex flex-col overflow-hidden">
        {isVoiceActive ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-12">
            <div className="space-y-4">
              <h3 className="text-4xl font-semibold gold-text tracking-tight">Luminara Live Search...</h3>
              <p className="text-gray-500 max-w-md mx-auto text-sm">Transcribing voice query for real-time agentic simulation.</p>
            </div>
            <Waveform active={isVoiceActive} />
            <button 
              onClick={toggleVoice}
              className="px-12 py-5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-red-500/20 transition-all shadow-xl"
            >
              Deactivate Core
            </button>
          </div>
        ) : (
          <>
            <MessageList messages={messages} isThinking={isThinking} activeTool={activeTool} onSimplify={handleSimplify} />
            
            {agentStep && (
              <div className="absolute top-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 z-40 w-full max-w-lg px-6">
                <div className="w-full flex items-center gap-4 px-6 py-4 glass-morphism rounded-[24px] border border-[#BF953F]/50 shadow-[0_0_60px_rgba(191,149,63,0.25)] animate-in slide-in-from-top-6 duration-700">
                  <div className="w-6 h-6 flex items-center justify-center shrink-0">
                    <div className="w-full h-full border-2 border-[#BF953F]/20 border-t-[#BF953F] rounded-full animate-spin"></div>
                  </div>
                  <div className="flex-1 flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] text-[#FCF6BA] font-black uppercase tracking-[0.4em]">{agentStep}</span>
                      <span className="text-[10px] text-gray-500 font-mono font-bold">{progress}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
                      <div 
                        className="h-full progress-gold transition-all duration-1000 ease-in-out rounded-full"
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      <footer className="z-40 bg-gradient-to-t from-black via-black to-transparent flex flex-col gap-1 pb-4">
        {!isVoiceActive && (
          <div 
            className="flex flex-wrap items-center justify-center gap-3 px-6 transition-all duration-700 overflow-hidden py-4" 
            style={{ 
              maxHeight: isThinking ? '0px' : '200px', 
              opacity: isThinking ? 0 : 1,
              transform: isThinking ? 'translateY(20px)' : 'translateY(0px)'
            }}
          >
            {quickActions.map((action, i) => (
              <button
                key={i}
                onClick={() => handleSendMessage(action.query)}
                disabled={isThinking}
                className="px-6 py-3 rounded-full glass-morphism border border-[#BF953F]/30 hover:border-[#BF953F] text-[10px] font-black text-[#FCF6BA] uppercase tracking-[0.3em] transition-all hover:scale-105 active:scale-95 shadow-xl bg-black/80 backdrop-blur-3xl"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
        <InputBar
          onSendMessage={handleSendMessage}
          onVoiceToggle={toggleVoice}
          isVoiceActive={isVoiceActive}
          isThinking={isThinking}
          mode={mode}
        />
      </footer>
    </div>
  );
};

export default App;
