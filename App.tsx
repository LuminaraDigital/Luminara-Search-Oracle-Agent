import React, { useState, useEffect, useCallback, useRef } from 'react';
import { OracleMode, Message, AppView, BusinessDNA, LAB_VIEWS } from './types';
import { LegalPage } from './components/LegalPage';
import { configService } from './services/configService';
import { geminiService, toChatHistory } from './services/geminiService';
import { OracleLiveService, LiveVoiceError } from './services/liveService';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Button } from './components/ui/Button';
import { useConfirm } from './components/ui/ConfirmModal';
import { isInTelegram, useTelegramBackButton, haptic, getStartParam } from './services/telegram/tma';
import { TelegramAccountPanel } from './components/telegram/TelegramAccountPanel';
import MessageList from './components/MessageList';
import InputBar from './components/InputBar';
import Waveform from './components/Waveform';
import LandingPage from './components/LandingPage';
import InfrastructurePage from './components/InfrastructurePage';
import IntelligencePage from './components/IntelligencePage';
import WhyLuminaraPage from './components/WhyLuminaraPage';
import PricingPage from './components/PricingPage';
import { InstantAuditView } from './components/audit/InstantAuditView';
import { BusinessDNAView } from './components/suite/BusinessDNAView';
import { DashboardView } from './components/suite/DashboardView';
import { StressTestView } from './components/suite/StressTestView';
import { DataAnalystView } from './components/suite/DataAnalystView';
import { OrganizerView } from './components/suite/OrganizerView';
import { ResearchView } from './components/suite/ResearchView';
import { VisionView } from './components/suite/VisionView';
import { TimesFMView } from './components/suite/TimesFMView';
import { OracleMindView } from './components/suite/OracleMindView';
import { ArchyHarnessView } from './components/harness/ArchyHarnessView';
import { OmnibarModal } from './components/harness/OmnibarModal';
import { timesfmService } from './services/timesfm/timesfmService';
import { themingService } from './services/harness/themingService';
import { agentMatrixService } from './services/harness/agentMatrixService';
import { reminderService } from './services/harness/reminderService';
import { ApiKeyModal } from './components/ApiKeyModal';
import { NativeEngineHUD } from './components/llm/NativeEngineHUD';
import { NativeFailoverPopup } from './components/llm/NativeFailoverPopup';
import { ICONS } from './constants';
import { startFirebaseAuthListener, isFirebaseConfigured } from './services/auth/firebaseAuthService';
import { useAppAuth, PUBLIC_APP_VIEWS } from './services/auth/useAppAuth';
import { AuthRequiredScreen } from './components/auth/AuthRequiredScreen';
import { PaywallModal } from './components/paywall/PaywallModal';
import { UsageQuotaBadge } from './components/paywall/UsageQuotaBadge';
import { AppIntroOverlay } from './components/intro/AppIntroOverlay';
import { hasSeenIntroThisSession } from './services/intro/appIntro';

const CHAT_STORAGE_KEY = 'luminara_chat_session';
const MARKETING_VIEWS = new Set<AppView>([
  AppView.LANDING,
  AppView.PRIVACY,
  AppView.TERMS,
  AppView.INFRASTRUCTURE,
  AppView.INTELLIGENCE,
  AppView.WHY_US,
  AppView.PRICING,
]);

interface SendOptions {
  /** Short text to show in the user bubble instead of the full prompt. */
  displayContent?: string;
  /** Skip the live SERP lookup for this turn. */
  skipSearch?: boolean;
}

const viewFromHash = (): AppView | null => {
  const h = window.location.hash.replace('#', '').toUpperCase();
  if (!h) return null;
  if (h.startsWith('HARNESS')) return AppView.HARNESS;
  if (h.startsWith('ORACLE_AGENT')) return AppView.ORACLE_AGENT;
  return (Object.values(AppView) as string[]).includes(h) ? (h as AppView) : null;
};

const App: React.FC = () => {
  const inTelegram = isInTelegram();
  const [view, setViewState] = useState<AppView>(() => {
    const fromHash = viewFromHash();
    if (fromHash) return fromHash;
    if (inTelegram) {
      const sp = (getStartParam() || '').toUpperCase();
      return (Object.values(AppView) as string[]).includes(sp) ? (sp as AppView) : AppView.INSTANT_AUDIT;
    }
    return AppView.LANDING;
  });
  /** Cinematic brand intro when the product opens (Telegram cold start or first web app entry). */
  const [showIntro, setShowIntro] = useState(() => {
    if (hasSeenIntroThisSession()) return false;
    if (inTelegram) return true;
    const fromHash = viewFromHash();
    return Boolean(fromHash && !MARKETING_VIEWS.has(fromHash));
  });
  const [introPendingView, setIntroPendingView] = useState<AppView | null>(null);
  const [viewHistory, setViewHistory] = useState<AppView[]>([]);
  const [timesfmInitialData, setTimesfmInitialData] = useState<any[] | undefined>(undefined);
  const [timesfmInitialName, setTimesfmInitialName] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = sessionStorage.getItem(CHAT_STORAGE_KEY);
      return saved ? (JSON.parse(saved) as Message[]) : [];
    } catch {
      return [];
    }
  });
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Keep the URL hash in sync with the active view so refresh and the back button work.
  const setView = useCallback((next: AppView) => {
    setViewState(prev => {
      if (prev !== next) setViewHistory(h => [...h.slice(-20), prev]);
      return next;
    });
    haptic('light');
    const target = `#${next.toLowerCase()}`;
    if (window.location.hash !== target) {
      window.history.pushState(null, '', target);
    }
  }, []);

  /** Enter a product surface; play the branded intro once per session before revealing the shell. */
  const enterApp = useCallback((next: AppView) => {
    if (!hasSeenIntroThisSession() && !showIntro && !MARKETING_VIEWS.has(next)) {
      setIntroPendingView(next);
      setShowIntro(true);
      return;
    }
    setView(next);
  }, [setView, showIntro]);

  const completeIntro = useCallback(() => {
    setShowIntro(false);
    if (introPendingView) {
      const next = introPendingView;
      setIntroPendingView(null);
      setView(next);
    }
  }, [introPendingView, setView]);

  // Conversation survives reloads within the tab (sessionStorage), not across devices.
  useEffect(() => {
    try {
      sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-60)));
    } catch {
      /* quota exceeded or storage disabled: chat just becomes ephemeral */
    }
  }, [messages]);
  const [mode, setMode] = useState<OracleMode>(OracleMode.FLASH);
  const [isThinking, setIsThinking] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [agentStep, setAgentStep] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [activeTool, setActiveTool] = useState<{ name: string; stage: string; output?: string } | null>(null);
  const [headerSearch, setHeaderSearch] = useState('');
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const { requestConfirm, confirmModal } = useConfirm();
  const [showSuiteMenu, setShowSuiteMenu] = useState(false);
  const [advancedUi, setAdvancedUi] = useState<boolean>(() => {
    try { return localStorage.getItem('luminara_advanced_ui') === '1'; } catch { return false; }
  });
  useEffect(() => {
    const onChange = () => { try { setAdvancedUi(localStorage.getItem('luminara_advanced_ui') === '1'); } catch { /* noop */ } };
    window.addEventListener('luminara-advanced-ui', onChange);
    return () => window.removeEventListener('luminara-advanced-ui', onChange);
  }, []);

  // Keep Firebase ID token cache warm for Worker hosted-key calls.
  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    return startFirebaseAuthListener();
  }, []);

  const appAuth = useAppAuth();

  // Any card can ask for the Settings dialog (e.g. "Set up results tracking") without prop drilling.
  useEffect(() => {
    const open = () => setIsKeyModalOpen(true);
    window.addEventListener('luminara-open-settings', open);
    return () => window.removeEventListener('luminara-open-settings', open);
  }, []);

  // Harness & Theming states
  const [isOmnibarOpen, setIsOmnibarOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState(themingService.getTheme());
  const [activeRemindersCount, setActiveRemindersCount] = useState(reminderService.getActiveReminders().length);
  const [defaultAgentName, setDefaultAgentName] = useState(agentMatrixService.getDefaultAgent().name);

  // Persistent Strategic Business DNA
  const [dna, setDna] = useState<BusinessDNA | null>(() => {
    try {
      const saved = localStorage.getItem('luminara_business_dna');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (dna) {
        localStorage.setItem('luminara_business_dna', JSON.stringify(dna));
      } else {
        localStorage.removeItem('luminara_business_dna');
      }
    } catch (e) {
      console.warn('Could not persist Business DNA', e);
    }
  }, [dna]);

  // First run: if no AI provider is configured anywhere (local key or hosted), open Settings once.
  useEffect(() => {
    if (showIntro) return;
    if (view === AppView.LANDING || view === AppView.PRIVACY || view === AppView.TERMS) return;
    const anyLlm = configService.getAllStatuses().some(s => s.category === 'llm' && s.isConfigured);
    if (!anyLlm && !sessionStorage.getItem('luminara_onboarding_shown')) {
      sessionStorage.setItem('luminara_onboarding_shown', '1');
      setIsKeyModalOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, showIntro]);

  // Telegram's native back button walks the in-app view history; hidden on the first screen.
  useEffect(() => {
    if (!inTelegram) return;
    const canGoBack = viewHistory.length > 0;
    return useTelegramBackButton(canGoBack ? () => {
      const prev = viewHistory[viewHistory.length - 1];
      setViewHistory(h => h.slice(0, -1));
      setViewState(prev);
    } : null);
  }, [inTelegram, viewHistory]);

  // Apply theme and global keyboard listener for Omnibar (Cmd+K / Ctrl+K / Super+Alt+Space)
  useEffect(() => {
    themingService.applyCssVariables(themingService.getTheme());

    const unsubTheme = themingService.subscribe(t => setCurrentTheme(t));
    const unsubRem = reminderService.subscribe(rems => {
      setActiveRemindersCount(rems.filter(r => !r.completed).length);
    });
    const unsubAgent = agentMatrixService.subscribe(() => {
      setDefaultAgentName(agentMatrixService.getDefaultAgent().name);
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+K toggles the omnibar. Escape closes it from anywhere in the app shell.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOmnibarOpen(prev => !prev);
        return;
      }
      if (e.key === 'Escape') {
        setIsOmnibarOpen(false);
      }
    };

    const handleHash = () => {
      const h = window.location.hash.replace('#', '').toUpperCase();
      if (h === 'SETTINGS' || h === 'INTEGRATIONS') {
        setIsKeyModalOpen(true);
        return;
      }
      const next = viewFromHash();
      if (next) setViewState(next);
    };
    // #settings / #integrations deep links open the key modal on first load too.
    if (['SETTINGS', 'INTEGRATIONS'].includes(window.location.hash.replace('#', '').toUpperCase())) setIsKeyModalOpen(true);
    window.addEventListener('hashchange', handleHash);
    window.addEventListener('popstate', handleHash);

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      unsubTheme();
      unsubRem();
      unsubAgent();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('hashchange', handleHash);
      window.removeEventListener('popstate', handleHash);
    };
  }, []);

  const liveServiceRef = useRef<OracleLiveService | null>(null);

  useEffect(() => {
    if (view === AppView.ORACLE_AGENT) {
      liveServiceRef.current = new OracleLiveService(
        (text, isUser) => {
          // Surface transcripts in the chat so voice turns are not lost.
          if (!isUser && text.trim()) {
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last && last.role === 'model' && last.id.startsWith('voice-') && last.isStreaming) {
                return prev.map(m => (m.id === last.id ? { ...m, content: text } : m));
              }
              return [...prev, { id: `voice-${Date.now()}`, role: 'model', content: text, timestamp: Date.now(), isStreaming: true }];
            });
          }
        },
        (active) => setIsVoiceActive(active),
        (err) => setVoiceError(err.message)
      );
    }

    return () => {
      liveServiceRef.current?.stop();
      liveServiceRef.current = null;
    };
  }, [view]);

  const handleSendMessage = useCallback(async (content: string, opts: SendOptions = {}) => {
    if (isThinking || !content.trim()) return;

    if (view !== AppView.ORACLE_AGENT) {
      setView(AppView.ORACLE_AGENT);
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      displayContent: opts.displayContent,
      timestamp: Date.now(),
    };

    // History is captured before appending this turn so the model sees prior turns + the new prompt once.
    const history = toChatHistory(messages.filter(m => !m.isError));

    setMessages(prev => [...prev, userMsg]);
    setIsThinking(true);
    setProgress(10);
    setAgentStep(opts.skipSearch ? 'Rewriting in plain English' : 'Getting ready');

    const modelId = (Date.now() + 1).toString();
    const modelMsg: Message = {
      id: modelId,
      role: 'model',
      content: '',
      timestamp: Date.now(),
      mode,
      isStreaming: true,
    };
    setMessages(prev => [...prev, modelMsg]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (!opts.skipSearch) {
        setIsSearching(true);
        setActiveTool({ name: 'Live search', stage: 'Checking what search engines say right now' });
      }

      let fullText = '';
      let allUrls: Array<{ uri: string; title: string }> = [];
      const toolExecutions: Message['toolExecutions'] = [];
      let firstToken = true;

      for await (const chunk of geminiService.streamQuery(content, mode, dna, { history, skipSearch: opts.skipSearch })) {
        if (controller.signal.aborted) break;

        if (chunk.toolExecution) {
          toolExecutions.push(chunk.toolExecution);
          setProgress(35);
          setActiveTool({ name: 'Live search', stage: chunk.toolExecution.output });
        }
        if (chunk.groundingUrls) {
          const existingUris = new Set(allUrls.map(u => u.uri));
          chunk.groundingUrls.forEach(u => {
            if (!existingUris.has(u.uri)) allUrls.push(u);
          });
        }
        if (chunk.text) {
          if (firstToken) {
            firstToken = false;
            setIsSearching(false);
            setActiveTool(null);
            setAgentStep('Writing your answer');
            setProgress(60);
          }
          fullText += chunk.text;
          setMessages(prev => prev.map(m => m.id === modelId
            ? { ...m, content: fullText, groundingUrls: allUrls, toolExecutions: toolExecutions.length ? [...toolExecutions] : undefined }
            : m));
        }
      }

      setProgress(100);
      setMessages(prev => prev.map(m => m.id === modelId
        ? { ...m, content: fullText || (controller.signal.aborted ? '*Stopped.*' : ''), groundingUrls: allUrls, isStreaming: false, toolExecutions: toolExecutions.length ? [...toolExecutions] : undefined }
        : m));
    } catch (error: any) {
      console.error('Luminara Search Error:', error);
      const reason = error?.message || 'Unknown error';
      setMessages(prev => prev.map(m => m.id === modelId
        ? { ...m, isStreaming: false, isError: true, content: `**I couldn't answer that.** ${reason}\n\nOpen Settings (the gear icon, top right) to check your AI key, then try again.` }
        : m));
    } finally {
      abortRef.current = null;
      setIsThinking(false);
      setIsSearching(false);
      setAgentStep(null);
      setActiveTool(null);
      setProgress(0);
      setHeaderSearch('');
    }
  }, [mode, isThinking, dna, view, messages, setView]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleClearChat = useCallback(() => {
    if (messages.length === 0) return;
    requestConfirm(
      {
        title: 'Clear this conversation?',
        description: 'All messages in this chat will be removed. This cannot be undone.',
        confirmLabel: 'Clear chat',
        variant: 'danger',
      },
      () => setMessages([]),
    );
  }, [messages.length, requestConfirm]);

  const toggleVoice = useCallback(async () => {
    if (!liveServiceRef.current) return;
    setVoiceError(null);

    if (isVoiceActive) {
      await liveServiceRef.current.stop();
      setIsVoiceActive(false);
      return;
    }

    try {
      await liveServiceRef.current.start();
      // onopen flips isVoiceActive via onStateChange once the socket is live.
    } catch (e: any) {
      const msg = e instanceof LiveVoiceError ? e.message : (e?.message || 'Could not start Live Voice.');
      setVoiceError(msg);
      setIsVoiceActive(false);
    }
  }, [isVoiceActive]);

  const handleSimplify = useCallback(async (content: string) => {
    handleSendMessage(
      `Execute [Plain English Protocol] to simplify this strategic analysis for an 8th-grade reading level. Use short, punchy sentences and remove marketing jargon: \n\n${content}`,
      { displayContent: 'Say that again in plain English.', skipSearch: true }
    );
  }, [handleSendMessage]);

  const quickActions = [
    { label: "Audit my website", query: "Run a full SEO, AEO and GEO audit of my website and give me a prioritised action plan in plain English." },
    { label: "Compare me with competitors", query: "Compare how my brand shows up in AI answers and search against my main competitors, and tell me where I lose." },
    { label: "Where do I show up in AI answers?", query: "Check whether my brand is cited in AI Overviews, ChatGPT and Perplexity for the questions my customers ask, and what to change." },
    { label: "What's missing on my site?", query: "Check my site for missing schema markup, unclear entity information and content gaps that stop AI engines from quoting it." }
  ];

  const introOverlay = showIntro ? <AppIntroOverlay onComplete={completeIntro} /> : null;

  if (view === AppView.PRIVACY || view === AppView.TERMS) {
    return (
      <>
        {introOverlay}
        <LegalPage kind={view === AppView.PRIVACY ? 'privacy' : 'terms'} onBack={() => setView(inTelegram ? AppView.DASHBOARD : AppView.LANDING)} />
      </>
    );
  }

  // Product tools require Telegram (Mini App) or Firebase (web). Marketing pages stay public.
  if (!PUBLIC_APP_VIEWS.has(view)) {
    if (appAuth.loading || !appAuth.authenticated) {
      return (
        <>
          {introOverlay}
          <AuthRequiredScreen
            auth={appAuth}
            onBackToMarketing={inTelegram ? undefined : () => setView(AppView.LANDING)}
          />
        </>
      );
    }
  }

  // Landing Page view (marketing site only; inside Telegram the app opens straight into the tools)
  if (view === AppView.LANDING && !inTelegram) {
    return (
      <>
        {introOverlay}
        <LandingPage 
          onEnter={() => enterApp(AppView.ORACLE_AGENT)} 
          onNavigateAudit={() => enterApp(AppView.INSTANT_AUDIT)}
          onNavigateSuite={() => enterApp(AppView.DASHBOARD)}
          onNavigateInfrastructure={() => setView(AppView.INFRASTRUCTURE)} 
          onNavigateIntelligence={() => setView(AppView.INTELLIGENCE)} 
          onNavigateWhy={() => setView(AppView.WHY_US)}
          onNavigatePricing={() => setView(AppView.PRICING)}
        />
        <ApiKeyModal 
          isOpen={isKeyModalOpen} 
          onClose={() => setIsKeyModalOpen(false)} 
          onKeySaved={() => {}} 
        />
        <OmnibarModal
          isOpen={isOmnibarOpen}
          onClose={() => setIsOmnibarOpen(false)}
          onNavigate={(v) => (MARKETING_VIEWS.has(v) ? setView(v) : enterApp(v))}
        />
        <NativeFailoverPopup />
      </>
    );
  }

  // Institutional Pages
  if (view === AppView.INFRASTRUCTURE) {
    return (
      <>
        {introOverlay}
        <InfrastructurePage 
          onBack={() => setView(AppView.LANDING)} 
          onTerminal={() => enterApp(AppView.ORACLE_AGENT)} 
          onNavigateIntelligence={() => setView(AppView.INTELLIGENCE)} 
          onNavigateWhy={() => setView(AppView.WHY_US)}
          onNavigatePricing={() => setView(AppView.PRICING)}
        />
      </>
    );
  }

  if (view === AppView.INTELLIGENCE) {
    return (
      <>
        {introOverlay}
        <IntelligencePage 
          onBack={() => setView(AppView.LANDING)} 
          onTerminal={() => enterApp(AppView.ORACLE_AGENT)} 
          onNavigateInfrastructure={() => setView(AppView.INFRASTRUCTURE)} 
          onNavigateWhy={() => setView(AppView.WHY_US)}
          onNavigatePricing={() => setView(AppView.PRICING)}
        />
      </>
    );
  }

  if (view === AppView.WHY_US) {
    return (
      <>
        {introOverlay}
        <WhyLuminaraPage 
          onBack={() => setView(AppView.LANDING)} 
          onTerminal={() => enterApp(AppView.ORACLE_AGENT)} 
          onNavigateInfrastructure={() => setView(AppView.INFRASTRUCTURE)}
          onNavigateIntelligence={() => setView(AppView.INTELLIGENCE)}
          onNavigatePricing={() => setView(AppView.PRICING)}
        />
      </>
    );
  }

  if (view === AppView.PRICING) {
    return (
      <>
        {introOverlay}
        <PricingPage 
          onBack={() => setView(AppView.LANDING)} 
          onTerminal={() => enterApp(AppView.ORACLE_AGENT)} 
          onNavigateInfrastructure={() => setView(AppView.INFRASTRUCTURE)}
          onNavigateIntelligence={() => setView(AppView.INTELLIGENCE)}
          onNavigateWhy={() => setView(AppView.WHY_US)}
        />
      </>
    );
  }

  // Main App Shell (Oracle Agent, Instant Audit, Command Suite, Harness)
  return (
    <>
    {introOverlay}
    <div
      className="flex flex-col bg-black text-ink overflow-hidden relative selection:bg-gold selection:text-black font-sans"
      style={{
        height: inTelegram ? 'var(--tg-viewport-stable-height, 100vh)' : '100vh',
        paddingTop: inTelegram ? 'var(--tg-viewport-content-safe-area-inset-top, var(--tg-viewport-safe-area-inset-top, 0px))' : undefined,
        paddingBottom: inTelegram ? 'var(--tg-viewport-safe-area-inset-bottom, 0px)' : undefined,
      }}
    >
      {/* Universal Top Header */}
      <header className="flex items-center justify-between px-4 sm:px-8 py-3 glass-morphism z-50 border-b border-gold/15 shrink-0 bg-black/80">
        {/* Left: Brand Identity */}
        <div className="flex items-center gap-4">
          <div className="w-9 h-9 cursor-pointer shrink-0" onClick={() => setView(inTelegram ? AppView.DASHBOARD : AppView.LANDING)}>
            <ICONS.LuminaraLogo 
              className={`w-full h-full transition-all duration-500 ${isVoiceActive ? 'drop-shadow-[0_0_15px_rgba(252,246,186,0.6)]' : ''}`} 
              isThinking={isThinking} 
              isVoice={isVoiceActive} 
            />
          </div>
          <div className="hidden sm:block cursor-pointer" onClick={() => setView(AppView.DASHBOARD)}>
            <h2 className="text-base font-bold tracking-[0.2em] uppercase gold-text leading-none">
              LUMINARA SUITE
            </h2>
            <span className="text-[7px] text-gray-500 uppercase tracking-[0.4em] font-mono block mt-1">
              AI search visibility
            </span>
          </div>
        </div>

        {/* Center: Suite Switcher & Quick Navigation */}
        <div className="flex items-center gap-2 sm:gap-4 max-w-2xl px-2">
          <Button
            variant="ghost"
            size="none"
            onClick={() => setView(AppView.ORACLE_AGENT)}
            aria-pressed={view === AppView.ORACLE_AGENT}
            className={`px-3 py-1.5 rounded-lg text-[10px] ${
              view === AppView.ORACLE_AGENT ? 'bg-gold/20 text-gold-light hover:text-gold-light hover:bg-gold/20 border border-gold/40' : ''
            }`}
          >
            Ask
          </Button>

          <Button
            variant="ghost"
            size="none"
            onClick={() => setView(AppView.INSTANT_AUDIT)}
            aria-pressed={view === AppView.INSTANT_AUDIT}
            className={`px-3 py-1.5 rounded-lg text-[10px] ${
              view === AppView.INSTANT_AUDIT ? 'bg-gold/20 text-gold-light hover:text-gold-light hover:bg-gold/20 border border-gold/40' : ''
            }`}
          >
            Audit my site
          </Button>

          {/* Command Suite Dropdown */}
          <div className="relative">
            <Button
              variant="ghost"
              size="none"
              onClick={() => setShowSuiteMenu(!showSuiteMenu)}
              aria-haspopup="menu"
              aria-expanded={showSuiteMenu}
              aria-pressed={[AppView.DASHBOARD, AppView.HARNESS, AppView.BUSINESS_DNA, AppView.STRESS_TEST, AppView.DATA_ANALYST, AppView.TIMESFM_FORECAST, AppView.ORACLE_MIND, AppView.ORGANIZER, AppView.RESEARCH, AppView.VISION].includes(view)}
              className={`px-3 py-1.5 rounded-lg text-[10px] ${
                [AppView.DASHBOARD, AppView.HARNESS, AppView.BUSINESS_DNA, AppView.STRESS_TEST, AppView.DATA_ANALYST, AppView.TIMESFM_FORECAST, AppView.ORACLE_MIND, AppView.ORGANIZER, AppView.RESEARCH, AppView.VISION].includes(view)
                  ? 'bg-gold/20 text-gold-light hover:text-gold-light hover:bg-gold/20 border border-gold/40'
                  : ''
              }`}
            >
              <span>More tools</span>
              <ICONS.ChevronDown className="w-3 h-3 text-gold" />
            </Button>

            {showSuiteMenu && (
              <div 
                className="absolute top-full left-0 mt-2 w-72 glass-morphism border border-gold/30 rounded-2xl p-2 shadow-2xl z-50 bg-black/95 animate-in fade-in zoom-in-95 duration-200"
                onMouseLeave={() => setShowSuiteMenu(false)}
              >
                <button
                  onClick={() => { setView(AppView.DASHBOARD); setShowSuiteMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-gold/10 transition-colors flex items-center gap-2"
                >
                  <ICONS.Shield className="w-3.5 h-3.5 text-gold-light" />
                  <span>Home</span>
                </button>
                {advancedUi && (<>
                <button
                  onClick={() => { setView(AppView.HARNESS); setShowSuiteMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gold-light hover:text-white hover:bg-gold/20 transition-colors flex items-center gap-2 bg-gold/15 border border-gold/40 my-0.5"
                >
                  <ICONS.Terminal className="w-3.5 h-3.5 text-gold-light" />
                  <div className="flex items-center justify-between flex-1">
                    <span className="font-bold">Developer harness</span>
                    <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-warning-500/20 text-warning-300 font-bold">LAB</span>
                  </div>
                </button>
                <button
                  onClick={() => { setView(AppView.ORACLE_MIND); setShowSuiteMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-gold/10 transition-colors flex items-center gap-2"
                >
                  <ICONS.Brain className="w-3.5 h-3.5 text-gold-light" />
                  <span>OracleMind SLM Studio <span className="text-[8px] text-warning-300 font-mono">LAB</span></span>
                </button>
                <button
                  onClick={() => { setView(AppView.TIMESFM_FORECAST); setShowSuiteMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-gold/10 transition-colors flex items-center gap-2"
                >
                  <ICONS.TimeSeries className="w-3.5 h-3.5 text-gold-light" />
                  <span>TimesFM Forecaster <span className="text-[8px] text-warning-300 font-mono">LAB</span></span>
                </button>
                </>)}
                <button
                  onClick={() => { setView(AppView.BUSINESS_DNA); setShowSuiteMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-gold/10 transition-colors flex items-center gap-2"
                >
                  <ICONS.DNA className="w-3.5 h-3.5 text-gold-light" />
                  <span>My business profile</span>
                </button>
                <button
                  onClick={() => { setView(AppView.STRESS_TEST); setShowSuiteMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-gold/10 transition-colors flex items-center gap-2"
                >
                  <ICONS.Stress className="w-3.5 h-3.5 text-gold-light" />
                  <span>Poke holes in my plan</span>
                </button>
                <button
                  onClick={() => { setView(AppView.DATA_ANALYST); setShowSuiteMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-gold/10 transition-colors flex items-center gap-2"
                >
                  <ICONS.Analyst className="w-3.5 h-3.5 text-gold-light" />
                  <span>Analyse my data</span>
                </button>
                <button
                  onClick={() => { setView(AppView.ORGANIZER); setShowSuiteMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-gold/10 transition-colors flex items-center gap-2"
                >
                  <ICONS.Organizer className="w-3.5 h-3.5 text-gold-light" />
                  <span>Turn notes into a plan</span>
                </button>
                <button
                  onClick={() => { setView(AppView.RESEARCH); setShowSuiteMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-gold/10 transition-colors flex items-center gap-2"
                >
                  <ICONS.Research className="w-3.5 h-3.5 text-gold-light" />
                  <span>Research the market</span>
                </button>
                <button
                  onClick={() => { setView(AppView.VISION); setShowSuiteMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-gold/10 transition-colors flex items-center gap-2 border-t border-white/5 mt-1 pt-2"
                >
                  <ICONS.Sparkle className="w-3.5 h-3.5 text-gold-light" />
                  <span>How Luminara works</span>
                </button>
              </div>
            )}
          </div>

          {/* Omnibar Fast Search Trigger Button */}
          <Button
            variant="ghost"
            size="none"
            onClick={() => setIsOmnibarOpen(true)}
            className="hidden md:inline-flex gap-2 px-3 py-1.5 rounded-full bg-white/5 hover:bg-gold/10 border border-white/10 hover:border-gold/40 text-xs font-mono font-normal normal-case tracking-normal max-w-[200px]"
            title="Open Omnibar (Cmd+K)"
          >
            <ICONS.Search className="w-3.5 h-3.5 text-gold" />
            <span className="truncate">Jump to a tool</span>
            <kbd className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-gray-300 ml-auto">⌘K</kbd>
          </Button>
        </div>

        {/* Right: Native LLM Trinity HUD, Omnibar, Theme, Agent Badge, DNA, Mode, Exit */}
        <div className="flex items-center justify-end gap-2 sm:gap-3">
          {/* Native Trinity (Groq, NVIDIA NIM, Ollama) Engine Status & Priority */}
          {advancedUi && <NativeEngineHUD />}

          {/* Default Agent Badge */}
          {advancedUi && <Button
            variant="ghost"
            size="none"
            onClick={() => setView(AppView.HARNESS)}
            className="hidden xl:inline-flex gap-1.5 px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-[9px] font-mono font-normal normal-case tracking-normal text-gray-300 hover:border-gold/50 hover:text-gold-light hover:bg-white/5"
            title="Active Default Agent (Click to open Archy Harness)"
          >
            <span className="text-gold">⚡</span>
            <span className="truncate max-w-[90px]">{defaultAgentName}</span>
          </Button>}

          {/* Theme Quick Cycle Button */}
          {advancedUi && <Button
            variant="ghost"
            size="none"
            onClick={() => themingService.cycleTheme()}
            className="hidden lg:inline-flex gap-1.5 px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-[9px] font-mono font-normal normal-case tracking-normal text-gray-300 hover:border-gold/50 hover:text-gold-light hover:bg-white/5"
            title={`Active Theme: ${currentTheme.name} (Click to cycle)`}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: currentTheme.palette.primaryGold }} />
            <span className="truncate max-w-[80px]">{currentTheme.name}</span>
          </Button>}

          {/* Reminders Count Indicator */}
          {activeRemindersCount > 0 && (
            <Button
              variant="ghost"
              size="none"
              onClick={() => setView(AppView.HARNESS)}
              className="gap-1 px-2 py-1 rounded-full border border-warning-500/30 bg-warning-500/10 text-warning-400 hover:text-warning-300 text-[9px] font-mono font-normal normal-case tracking-normal hover:bg-warning-500/20"
              title="Active Scheduled Reminders"
            >
              <span>⏰</span>
              <span>{activeRemindersCount}</span>
            </Button>
          )}

          {/* DNA Status Pill */}
          <Button
            variant="ghost"
            size="none"
            onClick={() => setView(AppView.BUSINESS_DNA)}
            className={`hidden sm:inline-flex gap-2 px-3 py-1 rounded-full border text-[9px] font-mono font-normal ${
              dna
                ? 'bg-success-500/10 border-success-500/30 text-success-400 hover:text-success-300 hover:bg-success-500/20'
                : 'bg-white/5 border-white/10 hover:text-gold-light hover:bg-white/5'
            }`}
            title="Strategic Business DNA Context"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${dna ? 'bg-success-400 shadow-[0_0_8px_theme(colors.success.500)]' : 'bg-gold'}`}></span>
            <span className="truncate max-w-[90px]">{dna ? dna.name : 'Add my business'}</span>
          </Button>

          {/* AI Usage Quota & Paywall Badge */}
          <UsageQuotaBadge />

          {/* API Key Modal Button */}
          <Button
            variant="ghost"
            size="none"
            onClick={() => setIsKeyModalOpen(true)}
            className="p-2 rounded-xl glass-morphism border border-white/10 hover:text-gold-light hover:border-gold/40 hover:bg-transparent"
            title="Settings and AI keys"
            aria-label="Settings and AI keys"
          >
            <ICONS.Settings className="w-4 h-4" />
          </Button>

          {/* Mode Selector */}
          <div className="flex items-center bg-surface-1 rounded-xl p-0.5 border border-white/5" role="group" aria-label="Answer mode">
            <Button
              variant="ghost"
              size="none"
              onClick={() => setMode(OracleMode.FLASH)}
              aria-pressed={mode === OracleMode.FLASH}
              className={`px-3 py-1 rounded-lg text-[9px] tracking-widest ${
                mode === OracleMode.FLASH ? 'bg-gradient-to-br from-gold to-gold-dark text-black hover:text-black hover:bg-transparent shadow-md' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Quick
            </Button>
            <Button
              variant="ghost"
              size="none"
              onClick={() => setMode(OracleMode.DEEP_THINK)}
              aria-pressed={mode === OracleMode.DEEP_THINK}
              className={`px-3 py-1 rounded-lg text-[9px] tracking-widest ${
                mode === OracleMode.DEEP_THINK ? 'bg-gradient-to-br from-gold to-gold-dark text-black hover:text-black hover:bg-transparent shadow-md' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Thorough
            </Button>
          </div>

          {!inTelegram && (
            <Button
              variant="ghost"
              size="none"
              onClick={() => setView(AppView.LANDING)}
              className="px-3 py-1.5 glass-morphism border border-white/5 rounded-xl text-[9px] tracking-widest font-black text-gray-500 hover:text-gold hover:bg-transparent"
            >
              Exit
            </Button>
          )}
        </div>
      </header>

      {/* Main App Container */}
      <main className="flex-1 relative flex flex-col overflow-y-auto">
        {LAB_VIEWS.has(view) && (
          <div className="shrink-0 px-4 py-2 text-center text-[10px] uppercase tracking-[0.25em] font-bold bg-warning-500/10 border-b border-warning-500/20 text-warning-300">
            Labs preview · figures on this screen are simulated for demonstration, not measured
          </div>
        )}
        <ErrorBoundary scope={view}>
        {/* VIEW: Instant Audit Scanner */}
        {view === AppView.INSTANT_AUDIT && (
          <InstantAuditView dna={dna} onNavigateDNA={() => setView(AppView.BUSINESS_DNA)} />
        )}

        {/* VIEW: Command Suite Dashboard */}
        {view === AppView.DASHBOARD && (
          <>
            {inTelegram && (
              <div className="max-w-4xl mx-auto w-full px-4 pt-6">
                <TelegramAccountPanel compact />
              </div>
            )}
            <DashboardView onNavigate={(v) => setView(v)} dna={dna} onClearDNA={() => setDna(null)} />
          </>
        )}

        {/* VIEW: Luminara Archy Developer Harness */}
        {view === AppView.HARNESS && (
          <ArchyHarnessView
            onNavigate={(v) => setView(v)}
            dna={dna}
            onOpenOmnibar={() => setIsOmnibarOpen(true)}
          />
        )}

        {/* VIEW: Strategic Business DNA */}
        {view === AppView.BUSINESS_DNA && (
          <BusinessDNAView
            currentDNA={dna}
            onDNAGenerated={(newDna) => setDna(newDna)}
            onNavigateToTool={() => setView(AppView.ORACLE_AGENT)}
            onRouteToOracleMind={() => setView(AppView.ORACLE_MIND)}
          />
        )}

        {/* VIEW: Red Team Stress Test */}
        {view === AppView.STRESS_TEST && (
          <StressTestView dna={dna} />
        )}

        {/* VIEW: Deep Data Analyst */}
        {view === AppView.DATA_ANALYST && (
          <DataAnalystView 
            dna={dna} 
            onRouteToTimesFM={(raw) => {
              const pts = timesfmService.parseTimeSeriesData(raw);
              setTimesfmInitialData(pts);
              setTimesfmInitialName('Data Analyst Ingested Sequence');
              setView(AppView.TIMESFM_FORECAST);
            }} 
          />
        )}

        {/* VIEW: TimesFM Foundation Forecaster */}
        {view === AppView.TIMESFM_FORECAST && (
          <TimesFMView 
            dna={dna} 
            initialData={timesfmInitialData} 
            initialName={timesfmInitialName} 
          />
        )}

        {/* VIEW: OracleMind SLM Studio */}
        {view === AppView.ORACLE_MIND && (
          <OracleMindView
            dna={dna}
            onRouteToDNA={() => setView(AppView.BUSINESS_DNA)}
            onRouteToOracle={(prompt) => {
              handleSendMessage(prompt);
            }}
          />
        )}

        {/* VIEW: Strategic Organizer */}
        {view === AppView.ORGANIZER && (
          <OrganizerView dna={dna} />
        )}

        {/* VIEW: Global Grounding Research */}
        {view === AppView.RESEARCH && (
          <ResearchView dna={dna} />
        )}

        {/* VIEW: Autonomy Manifesto */}
        {view === AppView.VISION && (
          <VisionView />
        )}

        {/* VIEW: Oracle Agent Terminal */}
        {view === AppView.ORACLE_AGENT && (
          isVoiceActive ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-12">
              <div className="space-y-4">
                <h3 className="text-4xl font-semibold gold-text tracking-tight">Listening…</h3>
                <p className="text-gray-500 max-w-md mx-auto text-sm">Talk normally. Your words and the answer appear in the chat when you stop.</p>
              </div>
              <Waveform active={isVoiceActive} />
              <button
                onClick={toggleVoice}
                className="px-12 py-5 bg-danger-500/10 text-danger-400 border border-danger-500/20 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-danger-500/20 transition-all shadow-xl"
              >
                Stop listening
              </button>
            </div>
          ) : (
            <>
              {voiceError && (
                <div className="mx-auto mt-4 max-w-2xl w-full px-4">
                  <div className="glass-morphism rounded-2xl border border-warning-500/30 bg-warning-950/20 px-5 py-3 text-xs text-warning-200 flex items-center justify-between gap-4" role="alert">
                    <span>{voiceError}</span>
                    <button onClick={() => setVoiceError(null)} className="text-warning-400 hover:text-white text-[10px] uppercase font-bold tracking-widest">Dismiss</button>
                  </div>
                </div>
              )}
              <MessageList messages={messages} isThinking={isThinking} activeTool={activeTool} onSimplify={handleSimplify} />
              
              {agentStep && (
                <div className="absolute top-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 z-40 w-full max-w-lg px-6">
                  <div className="w-full flex items-center gap-4 px-6 py-4 glass-morphism rounded-[24px] border border-gold/50 shadow-[0_0_60px_rgba(191,149,63,0.25)] animate-in slide-in-from-top-6 duration-700 bg-black/90">
                    <div className="w-6 h-6 flex items-center justify-center shrink-0">
                      <div className="w-full h-full border-2 border-gold/20 border-t-gold rounded-full animate-spin"></div>
                    </div>
                    <div className="flex-1 flex flex-col">
                      <div className="flex items-center justify-between mb-2 gap-3">
                        <span className="text-[11px] text-gold-light font-black uppercase tracking-[0.4em] truncate">{agentStep}</span>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-[10px] text-gray-500 font-mono font-bold">{progress}%</span>
                          <button onClick={handleStop} className="text-[9px] uppercase tracking-widest font-black text-danger-400 hover:text-danger-300 border border-danger-500/30 rounded-lg px-2 py-0.5" title="Stop generating">Stop</button>
                        </div>
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
          )
        )}
        </ErrorBoundary>
      </main>

      {/* Terminal Footer only in Oracle Agent View */}
      {view === AppView.ORACLE_AGENT && !isVoiceActive && (
        <footer className="z-40 bg-gradient-to-t from-black via-black to-transparent flex flex-col gap-1 pb-4 shrink-0">
          <div 
            className="flex flex-wrap items-center justify-center gap-3 px-6 transition-all duration-700 overflow-hidden py-3" 
            style={{ 
              maxHeight: isThinking ? '0px' : '200px', 
              opacity: isThinking ? 0 : 1,
              transform: isThinking ? 'translateY(20px)' : 'translateY(0px)'
            }}
          >
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="none"
                onClick={handleClearChat}
                disabled={isThinking}
                className="px-4 py-2.5 rounded-full border border-white/10 text-[10px] text-gray-500 hover:text-danger-300 hover:border-danger-500/30 hover:bg-transparent tracking-[0.2em] focus-visible:ring-danger-400 disabled:hover:text-gray-500 disabled:hover:border-white/10"
                title="Clear conversation"
              >
                Clear chat
              </Button>
            )}
            {quickActions.map((action, i) => (
              <button
                key={i}
                onClick={() => handleSendMessage(action.query)}
                disabled={isThinking}
                className="px-5 py-2.5 rounded-full glass-morphism border border-gold/30 hover:border-gold text-[10px] font-black text-gold-light uppercase tracking-[0.3em] transition-all hover:scale-105 active:scale-95 shadow-xl bg-black/80 backdrop-blur-3xl"
              >
                {action.label}
              </button>
            ))}
          </div>

          <InputBar
            onSendMessage={handleSendMessage}
            onVoiceToggle={toggleVoice}
            isVoiceActive={isVoiceActive}
            isThinking={isThinking}
            mode={mode}
          />
        </footer>
      )}

      {/* Global Omnibar Modal */}
      <OmnibarModal
        isOpen={isOmnibarOpen}
        onClose={() => setIsOmnibarOpen(false)}
        onNavigate={(v) => (MARKETING_VIEWS.has(v) ? setView(v) : enterApp(v))}
      />

      {/* Global API Key Modal */}
      <ApiKeyModal 
        isOpen={isKeyModalOpen} 
        onClose={() => setIsKeyModalOpen(false)} 
        onKeySaved={() => {}} 
      />

      {/* Global Dual-Rail Paywall Modal (Stars + TON) */}
      <PaywallModal onOpenSettings={() => setIsKeyModalOpen(true)} />

      {/* Real-time Native LLM Failover Floating Pop-up */}
      <NativeFailoverPopup />
      {confirmModal}
    </div>
    </>
  );
};

export default App;