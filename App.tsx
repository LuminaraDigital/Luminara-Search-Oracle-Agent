import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { OracleMode, Message, AppView, BusinessDNA, LAB_VIEWS } from './types';
import { configService } from './services/configService';
import { geminiService, toChatHistory } from './services/geminiService';
import { OracleLiveService, LiveVoiceError } from './services/liveService';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Button } from './components/ui/Button';
import { useConfirm } from './components/ui/ConfirmModal';
import { isInTelegram, useTelegramBackButton, haptic, getStartParam, subscribeTelegramReady, hasTelegramLaunchHints } from './services/telegram/tma';
import MessageList from './components/MessageList';
import InputBar from './components/InputBar';
import Waveform from './components/Waveform';
import LandingPage from './components/LandingPage';
import { themingService } from './services/harness/themingService';
import { agentMatrixService } from './services/harness/agentMatrixService';
import { reminderService } from './services/harness/reminderService';
import { NativeEngineHUD } from './components/llm/NativeEngineHUD';
import { NativeFailoverPopup } from './components/llm/NativeFailoverPopup';
import { ICONS } from './constants';
import { startFirebaseAuthListener, isFirebaseConfigured, signOutFirebase } from './services/auth/firebaseAuthService';
import { useAppAuth, PUBLIC_APP_VIEWS } from './services/auth/useAppAuth';
import { AuthRequiredScreen } from './components/auth/AuthRequiredScreen';
import { UsageQuotaBadge } from './components/paywall/UsageQuotaBadge';
import { TelegramBottomNav } from './components/telegram/TelegramBottomNav';
import { hasSeenIntroThisSession } from './services/intro/appIntro';
import { pullWorkspaceOnLogin, noteWorkspaceDirty, clearLocalWorkspace } from './services/sync/workspaceSyncService';
import { brandMemoryVaultService } from './services/memory/brandMemoryVaultService';
import { PremiumAtmosphere } from './components/ui/PremiumAtmosphere';
import { lazyWithReload } from './utils/lazyWithReload';
import { isDesktopShell } from './services/desktop/desktopShell';
import { productTelemetry } from './services/analytics/productTelemetry';

// Lazy-loaded secondary pages & views to keep the landing page and app shell ultra-lean.
// lazyWithReload recovers from post-deploy hashed chunk misses with one full page reload.
const LegalPage = lazyWithReload(() => import('./components/LegalPage').then(m => ({ default: m.LegalPage })));
const InfrastructurePage = lazyWithReload(() => import('./components/InfrastructurePage'));
const IntelligencePage = lazyWithReload(() => import('./components/IntelligencePage'));
const WhyLuminaraPage = lazyWithReload(() => import('./components/WhyLuminaraPage'));
const PricingPage = lazyWithReload(() => import('./components/PricingPage'));
const InstantAuditView = lazyWithReload(() => import('./components/audit/InstantAuditView').then(m => ({ default: m.InstantAuditView })));
const BusinessDNAView = lazyWithReload(() => import('./components/suite/BusinessDNAView').then(m => ({ default: m.BusinessDNAView })));
const BrandMemoryView = lazyWithReload(() => import('./components/suite/BrandMemoryView').then(m => ({ default: m.BrandMemoryView })));
const DashboardView = lazyWithReload(() => import('./components/suite/DashboardView').then(m => ({ default: m.DashboardView })));
const StressTestView = lazyWithReload(() => import('./components/suite/StressTestView').then(m => ({ default: m.StressTestView })));
const DataAnalystView = lazyWithReload(() => import('./components/suite/DataAnalystView').then(m => ({ default: m.DataAnalystView })));
const OrganizerView = lazyWithReload(() => import('./components/suite/OrganizerView').then(m => ({ default: m.OrganizerView })));
const ResearchView = lazyWithReload(() => import('./components/suite/ResearchView').then(m => ({ default: m.ResearchView })));
const VisionView = lazyWithReload(() => import('./components/suite/VisionView').then(m => ({ default: m.VisionView })));
const TimesFMView = lazyWithReload(() => import('./components/suite/TimesFMView').then(m => ({ default: m.TimesFMView })));
const OracleMindView = lazyWithReload(() => import('./components/suite/OracleMindView').then(m => ({ default: m.OracleMindView })));
const ArchyHarnessView = lazyWithReload(() => import('./components/harness/ArchyHarnessView').then(m => ({ default: m.ArchyHarnessView })));
const OmnibarModal = lazyWithReload(() => import('./components/harness/OmnibarModal').then(m => ({ default: m.OmnibarModal })));
const ApiKeyModal = lazyWithReload(() => import('./components/ApiKeyModal').then(m => ({ default: m.ApiKeyModal })));
const PaywallModal = lazyWithReload(() => import('./components/paywall/PaywallModal').then(m => ({ default: m.PaywallModal })));
import { ViewSkeleton } from './components/ui/Skeleton';

const AppIntroOverlay = lazyWithReload(() => import('./components/intro/AppIntroOverlay').then(m => ({ default: m.AppIntroOverlay })));
const TelegramAccountPanel = lazyWithReload(() => import('./components/telegram/TelegramAccountPanel').then(m => ({ default: m.TelegramAccountPanel })));
const NotebookView = lazyWithReload(() => import('./components/notebook/NotebookView').then(m => ({ default: m.NotebookView })));

const ViewLoader: React.FC<{ label?: string }> = ({ label = 'workspace' }) => (
  <ViewSkeleton viewName={label} />
);

const CHAT_STORAGE_KEY = 'luminara_chat_session';
const MARKETING_VIEWS = new Set<AppView>([
  AppView.LANDING,
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
  if (typeof window !== 'undefined') {
    const path = window.location.pathname.toLowerCase().replace(/^\/|\/$/g, '');
    if (path === 'privacy' || path === 'privacy-policy') return AppView.PRIVACY;
    if (path === 'terms' || path === 'terms-of-service' || path === 'tos') return AppView.TERMS;
  }
  const h = window.location.hash.replace('#', '').toUpperCase();
  if (!h) return null;
  if (h === 'PRIVACY' || h === 'PRIVACY-POLICY') return AppView.PRIVACY;
  if (h === 'TERMS' || h === 'TERMS-OF-SERVICE' || h === 'TOS') return AppView.TERMS;
  if (h.startsWith('HARNESS')) return AppView.HARNESS;
  if (h.startsWith('ORACLE_AGENT')) return AppView.ORACLE_AGENT;
  if (h.startsWith('NOTEBOOK') || h.startsWith('STUDIO')) return AppView.NOTEBOOK;
  return (Object.values(AppView) as string[]).includes(h) ? (h as AppView) : null;
};

const resolveTelegramStartView = (): AppView => {
  const sp = (getStartParam() || '').trim().toUpperCase();
  if (sp === 'AUDIT' || sp === 'SCAN') return AppView.INSTANT_AUDIT;
  if (sp === 'ORACLE' || sp === 'CHAT' || sp === 'ASK') return AppView.ORACLE_AGENT;
  if (sp === 'DASHBOARD' || sp === 'HOME') return AppView.DASHBOARD;
  if (sp === 'HARNESS' || sp === 'DEV') return AppView.HARNESS;
  if (sp === 'DNA' || sp === 'PROFILE') return AppView.BUSINESS_DNA;
  if (sp === 'MEMORY' || sp === 'VAULT' || sp === 'BRAND_MEMORY') return AppView.BRAND_MEMORY;
  if (sp === 'NOTEBOOK' || sp === 'NOTEBOOKS' || sp === 'STUDIO' || sp === 'LM') return AppView.NOTEBOOK;
  if (sp === 'PRIVACY' || sp === 'PRIVACY_POLICY' || sp === 'LEGAL') return AppView.PRIVACY;
  if (sp === 'TERMS' || sp === 'TOS') return AppView.TERMS;
  return (Object.values(AppView) as string[]).includes(sp) ? (sp as AppView) : AppView.INSTANT_AUDIT;
};

const App: React.FC = () => {
  const [inTelegram, setInTelegram] = useState(() => isInTelegram());
  const [inDesktop] = useState(() => isDesktopShell());
  const skipMarketing = inTelegram || inDesktop;
  const [view, setViewState] = useState<AppView>(() => {
    const fromHash = viewFromHash();
    if (fromHash) return fromHash;
    // Prefer product shell when Telegram already detected OR the bot deep-linked us.
    if (isInTelegram() || hasTelegramLaunchHints()) return resolveTelegramStartView();
    // Windows Electron shell: open the product, never the marketing landing.
    if (isDesktopShell()) return AppView.INSTANT_AUDIT;
    return AppView.LANDING;
  });

  // Keep TMA detection in sync after background initTelegram() finishes.
  useEffect(() => {
    return subscribeTelegramReady((inside) => {
      setInTelegram(inside);
      if (!inside) return;
      setViewState((current) => (current === AppView.LANDING ? resolveTelegramStartView() : current));
    });
  }, []);
  /** Cinematic brand intro when the product opens (disabled by default for instant load). */
  const [showIntro, setShowIntro] = useState(false);
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
  const [loginWallMode, setLoginWallMode] = useState<'signin' | 'signup' | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Keep the URL hash in sync with the active view so refresh and the back button work.
  const setView = useCallback((next: AppView) => {
    setViewState(prev => {
      if (prev !== next) setViewHistory(h => [...h.slice(-20), prev]);
      return next;
    });
    productTelemetry.trackPageView(next);
    haptic('light');
    const target = `#${next.toLowerCase()}`;
    if (window.location.hash !== target) {
      window.history.pushState(null, '', target);
    }
  }, []);

  useEffect(() => {
    productTelemetry.trackPageView(view);
  }, []);

  /** Enter a product surface immediately with zero latency. */
  const enterApp = useCallback((next: AppView) => {
    setView(next);
  }, [setView]);

  /**
   * Leave the product shell: sign out Firebase.
   * Web returns to marketing; Telegram/desktop stay in the native product shell (auth gate).
   */
  const logoutToLanding = useCallback(async () => {
    try {
      await signOutFirebase();
    } catch {
      /* still leave the shell even if sign-out fails */
    }
    clearLocalWorkspace();
    setDna(null);
    try {
      sessionStorage.removeItem(CHAT_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setMessages([]);
    setView(inDesktop || inTelegram ? AppView.INSTANT_AUDIT : AppView.LANDING);
  }, [setView, inDesktop, inTelegram]);

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
    if (messages.length) noteWorkspaceDirty();
  }, [messages]);

  // Telegram + Windows desktop: marketing views redirect into the functional app
  useEffect(() => {
    if (skipMarketing && MARKETING_VIEWS.has(view)) {
      setViewState(AppView.INSTANT_AUDIT);
    }
  }, [skipMarketing, view]);

  // Deep-link trigger for Telegram Stars / TON Paywall
  useEffect(() => {
    if (inTelegram) {
      const sp = (getStartParam() || '').toLowerCase();
      if (sp === 'plan' || sp === 'paywall' || sp === 'subscribe' || sp === 'pro' || sp === 'stars') {
        const timer = setTimeout(() => {
          window.dispatchEvent(new CustomEvent('luminara-open-paywall', { detail: { reason: 'Choose a plan to unlock NVIDIA NIM, Sovereign Ollama & OpenRouter' } }));
        }, 600);
        return () => clearTimeout(timer);
      }
    }
  }, [inTelegram]);
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

  // Level 4: keep product path on Liquid Gold; bounce Labs/ops when developer tools are off.
  useEffect(() => {
    themingService.ensureProductTheme();
    const gated = new Set<AppView>([
      AppView.HARNESS,
      AppView.ORACLE_MIND,
      AppView.TIMESFM_FORECAST,
      AppView.STRESS_TEST,
      AppView.DATA_ANALYST,
      AppView.ORGANIZER,
      AppView.RESEARCH,
    ]);
    if (!advancedUi && gated.has(view)) {
      setView(AppView.DASHBOARD);
    }
  }, [advancedUi, view]);

  // Keep Firebase ID token cache warm for Worker hosted-key calls.
  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    return startFirebaseAuthListener();
  }, []);

  const appAuth = useAppAuth();

  // After sign-in, restore DNA / audits / keys / chat from the linked account workspace.
  useEffect(() => {
    if (!appAuth.authenticated || appAuth.loading) return;
    if (loginWallMode) {
      setLoginWallMode(null);
      setView(AppView.DASHBOARD);
    }
    let cancelled = false;
    void (async () => {
      const result = await pullWorkspaceOnLogin();
      if (cancelled || !result.ok) return;
      try {
        const saved = localStorage.getItem('luminara_business_dna');
        setDna(saved ? JSON.parse(saved) as BusinessDNA : null);
      } catch {
        /* ignore */
      }
      try {
        const chat = sessionStorage.getItem(CHAT_STORAGE_KEY);
        if (chat) setMessages(JSON.parse(chat) as Message[]);
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, [appAuth.authenticated, appAuth.loading]);

  // Any card can ask for the Settings dialog (e.g. "Set up results tracking") without prop drilling.
  useEffect(() => {
    const open = () => setIsKeyModalOpen(true);
    const checkHash = () => {
      const h = window.location.hash.toUpperCase();
      if (h.includes('SETTINGS') || h.includes('KEYS')) {
        setIsKeyModalOpen(true);
      }
    };
    checkHash();
    window.addEventListener('hashchange', checkHash);
    window.addEventListener('luminara-open-settings', open);
    return () => {
      window.removeEventListener('hashchange', checkHash);
      window.removeEventListener('luminara-open-settings', open);
    };
  }, []);

  // Wiki competitor chips and alerts deep-link into Brand Memory Vault.
  useEffect(() => {
    const openMemory = () => setView(AppView.BRAND_MEMORY);
    window.addEventListener('luminara-open-brand-memory', openMemory);
    return () => window.removeEventListener('luminara-open-brand-memory', openMemory);
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
      noteWorkspaceDirty();
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
      if (fullText && !controller.signal.aborted && !opts.skipSearch) {
        try {
          brandMemoryVaultService.ingestChatInsight({
            question: content,
            answerExcerpt: fullText.slice(0, 1500),
            dna,
          });
        } catch {
          /* memory optional */
        }
      }
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

  const introOverlay = showIntro ? <Suspense fallback={null}><AppIntroOverlay onComplete={completeIntro} /></Suspense> : null;

  if (view === AppView.PRIVACY || view === AppView.TERMS) {
    return (
      <Suspense fallback={<ViewLoader label="Loading document" />}>
        {introOverlay}
        <LegalPage kind={view === AppView.PRIVACY ? 'privacy' : 'terms'} onBack={() => setView(skipMarketing ? AppView.DASHBOARD : AppView.LANDING)} />
      </Suspense>
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
            onBackToMarketing={skipMarketing ? undefined : () => setView(AppView.LANDING)}
          />
        </>
      );
    }
  }

  // Landing Page view (marketing site only; Telegram and desktop open straight into the tools)
  if (view === AppView.LANDING && !skipMarketing) {
    return (
      <>
        {introOverlay}
        <LandingPage 
          onEnter={() => {
            if (!appAuth.authenticated) {
              setLoginWallMode('signin');
            } else {
              enterApp(AppView.ORACLE_AGENT);
            }
          }} 
          onNavigateAudit={() => {
            if (!appAuth.authenticated) {
              setLoginWallMode('signup');
            } else {
              enterApp(AppView.INSTANT_AUDIT);
            }
          }}
          onNavigateSuite={() => {
            if (!appAuth.authenticated) {
              setLoginWallMode('signin');
            } else {
              enterApp(AppView.DASHBOARD);
            }
          }}
          onNavigateInfrastructure={() => setView(AppView.INFRASTRUCTURE)} 
          onNavigateIntelligence={() => setView(AppView.INTELLIGENCE)} 
          onNavigateWhy={() => setView(AppView.WHY_US)}
          onNavigatePricing={() => setView(AppView.PRICING)}
          isAuthenticated={appAuth.authenticated}
          userLabel={appAuth.label || null}
          onSignInClick={() => setLoginWallMode('signin')}
          onSignUpClick={() => setLoginWallMode('signup')}
        />
        {loginWallMode && (
          <AuthRequiredScreen
            auth={appAuth}
            initialMode={loginWallMode}
            isModal
            onClose={() => setLoginWallMode(null)}
          />
        )}
        <Suspense fallback={null}>
          {isKeyModalOpen && (
            <ApiKeyModal 
              isOpen={isKeyModalOpen} 
              onClose={() => setIsKeyModalOpen(false)} 
              onKeySaved={() => {}} 
            />
          )}
          {isOmnibarOpen && (
            <OmnibarModal
              isOpen={isOmnibarOpen}
              onClose={() => setIsOmnibarOpen(false)}
              onNavigate={(v) => (MARKETING_VIEWS.has(v) ? setView(v) : enterApp(v))}
            />
          )}
        </Suspense>
        <NativeFailoverPopup />
      </>
    );
  }

  // Institutional Pages
  if (view === AppView.INFRASTRUCTURE) {
    return (
      <Suspense fallback={<ViewLoader label="Loading infrastructure" />}>
        {introOverlay}
        <InfrastructurePage 
          onBack={() => setView(AppView.LANDING)} 
          onTerminal={() => enterApp(AppView.ORACLE_AGENT)} 
          onNavigateIntelligence={() => setView(AppView.INTELLIGENCE)} 
          onNavigateWhy={() => setView(AppView.WHY_US)}
          onNavigatePricing={() => setView(AppView.PRICING)}
        />
      </Suspense>
    );
  }

  if (view === AppView.INTELLIGENCE) {
    return (
      <Suspense fallback={<ViewLoader label="Loading intelligence" />}>
        {introOverlay}
        <IntelligencePage 
          onBack={() => setView(AppView.LANDING)} 
          onTerminal={() => enterApp(AppView.ORACLE_AGENT)} 
          onNavigateInfrastructure={() => setView(AppView.INFRASTRUCTURE)} 
          onNavigateWhy={() => setView(AppView.WHY_US)}
          onNavigatePricing={() => setView(AppView.PRICING)}
        />
      </Suspense>
    );
  }

  if (view === AppView.WHY_US) {
    return (
      <Suspense fallback={<ViewLoader label="Loading" />}>
        {introOverlay}
        <WhyLuminaraPage 
          onBack={() => setView(AppView.LANDING)} 
          onTerminal={() => enterApp(AppView.ORACLE_AGENT)} 
          onNavigateInfrastructure={() => setView(AppView.INFRASTRUCTURE)}
          onNavigateIntelligence={() => setView(AppView.INTELLIGENCE)}
          onNavigatePricing={() => setView(AppView.PRICING)}
        />
      </Suspense>
    );
  }

  if (view === AppView.PRICING) {
    return (
      <Suspense fallback={<ViewLoader label="Loading pricing" />}>
        {introOverlay}
        <PricingPage 
          onBack={() => setView(AppView.LANDING)} 
          onTerminal={() => enterApp(AppView.ORACLE_AGENT)} 
          onNavigateInfrastructure={() => setView(AppView.INFRASTRUCTURE)}
          onNavigateIntelligence={() => setView(AppView.INTELLIGENCE)}
          onNavigateWhy={() => setView(AppView.WHY_US)}
        />
      </Suspense>
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
      <PremiumAtmosphere intensity="subtle" />
      {/* Universal Top Header - Responsive, guaranteed no overflow */}
      <header className="flex items-center justify-between px-3 sm:px-6 py-2.5 glass-morphism z-50 border-b border-gold/20 shrink-0 bg-black/80 backdrop-blur-2xl w-full max-w-full">
        {/* Left: Brand Identity */}
        <button
          type="button"
          onClick={() => {
            if (inTelegram) setView(AppView.DASHBOARD);
            else void logoutToLanding();
          }}
          className="flex items-center gap-2.5 sm:gap-3 shrink-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-xl p-1 -m-1 transition-all"
          title={inTelegram ? 'Dashboard' : 'Log out and return home'}
          aria-label={inTelegram ? 'Luminara Dashboard' : 'Log out and return home'}
        >
          <div className="w-8 h-8 sm:w-9 sm:h-9 shrink-0">
            <ICONS.LuminaraLogo 
              className={`w-full h-full transition-all duration-500 ${isVoiceActive ? 'drop-shadow-[0_0_15px_rgba(252,246,186,0.6)]' : ''}`} 
              isThinking={isThinking} 
              isVoice={isVoiceActive} 
            />
          </div>
          <div className="hidden sm:block">
            <h2 className="text-sm sm:text-base font-bold tracking-[0.2em] uppercase gold-text leading-none">
              LUMINARA
            </h2>
          </div>
        </button>

        {/* Center: Suite Switcher & Quick Navigation */}
        <nav className="flex items-center gap-1 sm:gap-2 shrink min-w-0 px-1 overflow-x-auto no-scrollbar">
          <Button
            variant="ghost"
            size="none"
            onClick={() => setView(AppView.ORACLE_AGENT)}
            aria-pressed={view === AppView.ORACLE_AGENT}
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[10px] shrink-0 ${
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
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[10px] shrink-0 ${
              view === AppView.INSTANT_AUDIT ? 'bg-gold/20 text-gold-light hover:text-gold-light hover:bg-gold/20 border border-gold/40' : ''
            }`}
          >
            Audit
          </Button>

          <Button
            variant="ghost"
            size="none"
            onClick={() => setView(AppView.BRAND_MEMORY)}
            aria-pressed={view === AppView.BRAND_MEMORY}
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[10px] shrink-0 ${
              view === AppView.BRAND_MEMORY ? 'bg-gold/20 text-gold-light hover:text-gold-light hover:bg-gold/20 border border-gold/40' : ''
            }`}
          >
            Memory
          </Button>

          <Button
            variant="ghost"
            size="none"
            onClick={() => setView(AppView.NOTEBOOK)}
            aria-pressed={view === AppView.NOTEBOOK}
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[10px] shrink-0 ${
              view === AppView.NOTEBOOK ? 'bg-gold/20 text-gold-light hover:text-gold-light hover:bg-gold/20 border border-gold/40' : ''
            }`}
            title="Luminara Studio - Grounded Research Dossiers & Audio Overviews"
          >
            Studio
          </Button>

          {/* Command Suite Dropdown */}
          <div className="relative shrink-0">
            <Button
              variant="ghost"
              size="none"
              onClick={() => setShowSuiteMenu(!showSuiteMenu)}
              aria-haspopup="menu"
              aria-expanded={showSuiteMenu}
              aria-pressed={[AppView.DASHBOARD, AppView.NOTEBOOK, AppView.HARNESS, AppView.BUSINESS_DNA, AppView.STRESS_TEST, AppView.DATA_ANALYST, AppView.TIMESFM_FORECAST, AppView.ORACLE_MIND, AppView.ORGANIZER, AppView.RESEARCH, AppView.VISION].includes(view)}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[10px] shrink-0 ${
                [AppView.DASHBOARD, AppView.NOTEBOOK, AppView.HARNESS, AppView.BUSINESS_DNA, AppView.STRESS_TEST, AppView.DATA_ANALYST, AppView.TIMESFM_FORECAST, AppView.ORACLE_MIND, AppView.ORGANIZER, AppView.RESEARCH, AppView.VISION].includes(view)
                  ? 'bg-gold/20 text-gold-light hover:text-gold-light hover:bg-gold/20 border border-gold/40'
                  : ''
              }`}
            >
              <span>More</span>
              <ICONS.ChevronDown className="w-3 h-3 text-gold" />
            </Button>

            {showSuiteMenu && (
              <div 
                className="absolute top-full left-0 mt-2 w-72 glass-morphism border border-gold/30 rounded-2xl p-2 shadow-2xl z-50 bg-black/95 animate-in fade-in zoom-in-95 duration-200"
                onMouseLeave={() => setShowSuiteMenu(false)}
              >
                <button
                  type="button"
                  onClick={() => { setView(AppView.DASHBOARD); setShowSuiteMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-gold/10 transition-colors flex items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-gold"
                >
                  <ICONS.Shield className="w-3.5 h-3.5 text-gold-light" />
                  <span>Home</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setView(AppView.NOTEBOOK); setShowSuiteMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gold-light hover:text-white hover:bg-gold/20 transition-colors flex items-center gap-2 bg-gold/15 border border-gold/40 my-0.5 outline-none focus-visible:ring-2 focus-visible:ring-gold"
                >
                  <ICONS.Notebook className="w-3.5 h-3.5 text-gold-light" />
                  <div className="flex items-center justify-between flex-1">
                    <span className="font-bold">Intelligence Studio</span>
                    <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-gold/20 text-gold-light font-bold">STUDIO</span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => { setView(AppView.BUSINESS_DNA); setShowSuiteMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-gold/10 transition-colors flex items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-gold"
                >
                  <ICONS.DNA className="w-3.5 h-3.5 text-gold-light" />
                  <span>My business profile</span>
                </button>
                {advancedUi && (<>
                <button
                  type="button"
                  onClick={() => { setView(AppView.HARNESS); setShowSuiteMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gold-light hover:text-white hover:bg-gold/20 transition-colors flex items-center gap-2 bg-gold/15 border border-gold/40 my-0.5 outline-none focus-visible:ring-2 focus-visible:ring-gold"
                >
                  <ICONS.Terminal className="w-3.5 h-3.5 text-gold-light" />
                  <div className="flex items-center justify-between flex-1">
                    <span className="font-bold">Developer harness</span>
                    <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-warning-500/20 text-warning-300 font-bold">LAB</span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => { setView(AppView.ORACLE_MIND); setShowSuiteMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-gold/10 transition-colors flex items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-gold"
                >
                  <ICONS.Brain className="w-3.5 h-3.5 text-gold-light" />
                  <span>OracleMind SLM Studio <span className="text-[8px] text-warning-300 font-mono">LAB</span></span>
                </button>
                <button
                  type="button"
                  onClick={() => { setView(AppView.TIMESFM_FORECAST); setShowSuiteMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-gold/10 transition-colors flex items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-gold"
                >
                  <ICONS.TimeSeries className="w-3.5 h-3.5 text-gold-light" />
                  <span>TimesFM Forecaster <span className="text-[8px] text-warning-300 font-mono">LAB</span></span>
                </button>
                <button
                  type="button"
                  onClick={() => { setView(AppView.STRESS_TEST); setShowSuiteMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-gold/10 transition-colors flex items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-gold"
                >
                  <ICONS.Stress className="w-3.5 h-3.5 text-gold-light" />
                  <span>Poke holes in my plan</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setView(AppView.DATA_ANALYST); setShowSuiteMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-gold/10 transition-colors flex items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-gold"
                >
                  <ICONS.Analyst className="w-3.5 h-3.5 text-gold-light" />
                  <span>Analyse my data</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setView(AppView.ORGANIZER); setShowSuiteMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-gold/10 transition-colors flex items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-gold"
                >
                  <ICONS.Organizer className="w-3.5 h-3.5 text-gold-light" />
                  <span>Turn notes into a plan</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setView(AppView.RESEARCH); setShowSuiteMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-gold/10 transition-colors flex items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-gold"
                >
                  <ICONS.Research className="w-3.5 h-3.5 text-gold-light" />
                  <span>Research the market</span>
                </button>
                </>)}
                <button
                  type="button"
                  onClick={() => { setView(AppView.VISION); setShowSuiteMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-gold/10 transition-colors flex items-center gap-2 border-t border-white/5 mt-1 pt-2 outline-none focus-visible:ring-2 focus-visible:ring-gold"
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
            className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 hover:bg-gold/10 border border-white/10 hover:border-gold/40 text-xs font-mono font-normal normal-case tracking-normal shrink-0"
            title="Open Omnibar (Cmd+K)"
          >
            <ICONS.Search className="w-3.5 h-3.5 text-gold" />
            <span className="hidden xl:inline truncate">Jump to a tool</span>
            <kbd className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-gray-300">⌘K</kbd>
          </Button>
        </nav>

        {/* Right: Native LLM Trinity HUD, Omnibar, Theme, Agent Badge, DNA, Mode, Settings, Log out */}
        <div className="flex items-center justify-end gap-1.5 sm:gap-2.5 shrink-0">
          {/* Native Trinity (Groq, NVIDIA NIM, Ollama) Engine Status & Priority */}
          {advancedUi && <NativeEngineHUD />}

          {/* Default Agent Badge - visible on 2xl displays only to prevent crowding */}
          {advancedUi && <Button
            variant="ghost"
            size="none"
            onClick={() => setView(AppView.HARNESS)}
            className="hidden 2xl:inline-flex gap-1.5 px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-[9px] font-mono font-normal normal-case tracking-normal text-gray-300 hover:border-gold/50 hover:text-gold-light hover:bg-white/5 shrink-0"
            title="Active Default Agent (Click to open Archy Harness)"
          >
            <span className="text-gold">⚡</span>
            <span className="truncate max-w-[90px]">{defaultAgentName}</span>
          </Button>}

          {/* Theme Quick Cycle Button - visible on 2xl displays only */}
          {advancedUi && <Button
            variant="ghost"
            size="none"
            onClick={() => themingService.cycleTheme()}
            className="hidden 2xl:inline-flex gap-1.5 px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-[9px] font-mono font-normal normal-case tracking-normal text-gray-300 hover:border-gold/50 hover:text-gold-light hover:bg-white/5 shrink-0"
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
              className="gap-1 px-2 py-1 rounded-full border border-warning-500/30 bg-warning-500/10 text-warning-400 hover:text-warning-300 text-[9px] font-mono font-normal normal-case tracking-normal hover:bg-warning-500/20 shrink-0"
              title="Active Scheduled Reminders"
            >
              <span>⏰</span>
              <span>{activeRemindersCount}</span>
            </Button>
          )}

          {/* DNA Status Pill - visible on xl+ displays */}
          <Button
            variant="ghost"
            size="none"
            onClick={() => setView(AppView.BUSINESS_DNA)}
            className={`hidden xl:inline-flex gap-2 px-3 py-1 rounded-full border text-[9px] font-mono font-normal shrink-0 ${
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
          <div className="shrink-0">
            <UsageQuotaBadge />
          </div>

          {/* Settings and AI Keys Button - GUARANTEED PROMINENT & ALWAYS VISIBLE */}
          <Button
            variant="ghost"
            size="none"
            onClick={() => setIsKeyModalOpen(true)}
            className="p-2 rounded-xl glass-morphism border border-gold/40 text-gold-light hover:text-white hover:border-gold hover:bg-gold/10 shrink-0 transition-all shadow-[0_0_12px_rgba(191,149,63,0.18)]"
            title="Settings (AI Keys & Config)"
            aria-label="Settings and AI keys"
          >
            <ICONS.Settings className="w-4 h-4" />
          </Button>

          {/* Mode Selector - Quick / Thorough */}
          <div className="hidden sm:flex items-center bg-surface-1 rounded-xl p-0.5 border border-white/10 shrink-0" role="group" aria-label="Answer mode">
            <Button
              variant="ghost"
              size="none"
              onClick={() => setMode(OracleMode.FLASH)}
              aria-pressed={mode === OracleMode.FLASH}
              className={`px-2.5 sm:px-3 py-1 rounded-lg text-[9px] tracking-widest ${
                mode === OracleMode.FLASH ? 'bg-gradient-to-br from-gold to-gold-dark text-black hover:text-black hover:bg-transparent shadow-md font-bold' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Quick
            </Button>
            <Button
              variant="ghost"
              size="none"
              onClick={() => setMode(OracleMode.DEEP_THINK)}
              aria-pressed={mode === OracleMode.DEEP_THINK}
              className={`px-2.5 sm:px-3 py-1 rounded-lg text-[9px] tracking-widest ${
                mode === OracleMode.DEEP_THINK ? 'bg-gradient-to-br from-gold to-gold-dark text-black hover:text-black hover:bg-transparent shadow-md font-bold' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Thorough
            </Button>
          </div>

          {!inTelegram && (
            <Button
              variant="ghost"
              size="none"
              onClick={() => void logoutToLanding()}
              className="px-2.5 sm:px-3 py-1.5 glass-morphism border border-white/5 rounded-xl text-[9px] tracking-widest font-black text-gray-500 hover:text-gold hover:bg-transparent shrink-0"
            >
              Log out
            </Button>
          )}
        </div>
      </header>

      {/* Main App Container - min-h-0 ensures flex child heights and scrollbars calculate cleanly */}
      <main className="flex-1 min-h-0 relative z-10 flex flex-col overflow-y-auto">
        {LAB_VIEWS.has(view) && (
          <div className="shrink-0 px-4 py-2 text-center text-[10px] uppercase tracking-[0.25em] font-bold bg-warning-500/10 border-b border-warning-500/20 text-warning-300">
            Labs preview · figures on this screen are simulated for demonstration, not measured
          </div>
        )}
        <ErrorBoundary scope={view}>
        <Suspense fallback={<ViewLoader label="Loading workspace" />}>
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
            <DashboardView onNavigate={(v) => setView(v)} dna={dna} onClearDNA={() => setDna(null)} advancedUi={advancedUi} />
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

        {view === AppView.BRAND_MEMORY && (
          <BrandMemoryView
            dna={dna}
            onNavigate={(v) => setView(v)}
            onOpenPaywall={() => window.dispatchEvent(new CustomEvent('luminara-open-paywall', { detail: { reason: 'Unlock Pro / Agency for client workspaces and deeper memory' } }))}
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
            onRouteToTimesFM={async (raw) => {
              const { timesfmService } = await import('./services/timesfm/timesfmService');
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

        {/* VIEW: Luminara Intelligence Studio */}
        {view === AppView.NOTEBOOK && (
          <NotebookView dna={dna} />
        )}
        </Suspense>

        {/* VIEW: Oracle Agent Terminal */}
        {view === AppView.ORACLE_AGENT && (
          isVoiceActive ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-12">
              <div className="space-y-4">
                <h3 className="text-4xl font-semibold gold-text tracking-tight">Listening…</h3>
                <p className="text-gray-400 max-w-md mx-auto text-sm">Speak normally. Your words and response will appear when you pause.</p>
              </div>
              <Waveform active={isVoiceActive} />
              <button
                type="button"
                onClick={toggleVoice}
                className="px-12 py-5 bg-danger-500/10 text-danger-400 border border-danger-500/20 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-danger-500/20 transition-all shadow-xl outline-none focus-visible:ring-2 focus-visible:ring-danger-400"
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
                    <button type="button" onClick={() => setVoiceError(null)} className="text-warning-400 hover:text-white text-[10px] uppercase font-bold tracking-widest outline-none focus-visible:ring-2 focus-visible:ring-warning-400 rounded px-1">Dismiss</button>
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
                          <span className="text-[10px] text-gray-400 font-mono font-bold">{progress}%</span>
                          <button type="button" onClick={handleStop} className="text-[9px] uppercase tracking-widest font-black text-danger-400 hover:text-danger-300 border border-danger-500/30 rounded-lg px-2 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-danger-400" title="Stop generating" aria-label="Stop generating">Stop</button>
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
        <footer className="z-40 bg-gradient-to-t from-black via-black to-transparent flex flex-col gap-0.5 pb-2 shrink-0">
          <div 
            className="flex flex-wrap items-center justify-center gap-2 px-4 transition-all duration-700 overflow-hidden py-1.5 sm:py-2" 
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
                className="px-3 py-1.5 rounded-full border border-white/10 text-[9px] text-gray-400 hover:text-danger-300 hover:border-danger-500/30 hover:bg-transparent tracking-[0.2em] focus-visible:ring-danger-400 disabled:hover:text-gray-400 disabled:hover:border-white/10"
                title="Clear conversation"
              >
                Clear chat
              </Button>
            )}
            {quickActions.map((action, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSendMessage(action.query)}
                disabled={isThinking}
                className="px-3.5 sm:px-4 py-1.5 rounded-full glass-morphism border border-gold/30 hover:border-gold text-[9px] font-black text-gold-light uppercase tracking-[0.25em] transition-all hover:scale-105 active:scale-95 shadow-lg bg-black/80 backdrop-blur-3xl outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-50 disabled:cursor-not-allowed"
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

      {/* Telegram Native Mobile Bottom Navigation */}
      {inTelegram && (
        <TelegramBottomNav
          currentView={view}
          onNavigate={(v) => setView(v)}
          onOpenPaywall={() => window.dispatchEvent(new CustomEvent('luminara-open-paywall'))}
          onOpenTools={() => setShowSuiteMenu(prev => !prev)}
        />
      )}

      {/* Global Modals */}
      <Suspense fallback={null}>
        {isOmnibarOpen && (
          <OmnibarModal
            isOpen={isOmnibarOpen}
            onClose={() => setIsOmnibarOpen(false)}
            onNavigate={(v) => (MARKETING_VIEWS.has(v) ? setView(v) : enterApp(v))}
          />
        )}

        {isKeyModalOpen && (
          <ApiKeyModal 
            isOpen={isKeyModalOpen} 
            onClose={() => setIsKeyModalOpen(false)} 
            onKeySaved={() => {}} 
          />
        )}

        {/* Global Dual-Rail Paywall Modal (Stars + TON) */}
        <PaywallModal onOpenSettings={() => setIsKeyModalOpen(true)} />
      </Suspense>

      {/* Real-time Native LLM Failover Floating Pop-up */}
      <NativeFailoverPopup />
      {confirmModal}
    </div>
    </>
  );
};

export default App;