/**
 * Product Telemetry & Retention Tracking Engine
 * Tracks user friction, onboarding completion, drop-off funnels, and Time-to-First-Value (TTFV).
 * 100% Privacy-First: All telemetry is stored locally in localStorage by default.
 * Zero external ad tracking or PII leakage.
 */

export const ALL_TELEMETRY_EVENT_TYPES = [
  'session_started',
  'page_view',
  'onboarding_started',
  'onboarding_step_completed',
  'onboarding_completed',
  'time_to_first_value',
  'core_action_completed',
  'error_encountered',
  'funnel_abandoned',
  'draft_restored',
  'probe_completed',
  'signup_completed',
  'instant_audit_completed',
  'paywall_viewed',
  'checkout_started',
  'payment_completed',
  'strategy_saved',
  'share_cta_clicked',
  'share_link_created',
  'share_link_opened',
  'mcp_key_created',
  'mcp_snippet_copied',
  'mcp_first_used',
  'upgrade_prompt_shown',
  'upgrade_prompt_clicked',
  'upgrade_prompt_dismissed',
  'share_clicked',
  'share_page_view',
  'fix_shipped',
  'mission_completed',
  'plan_expiring',
  'plan_expired',
  'survey_answered',
] as const;

export type TelemetryEventType = (typeof ALL_TELEMETRY_EVENT_TYPES)[number];

export interface TelemetryEvent {
  id: string;
  type: TelemetryEventType;
  timestamp: number;
  data?: Record<string, any>;
}

export interface TelemetryMetricsSummary {
  sessionCount: number;
  firstSessionTime: number;
  timeToFirstValueMs: number | null;
  firstValueAction: string | null;
  onboardingCompleted: boolean;
  completedOnboardingSteps: string[];
  totalAuditsRun: number;
  totalChatsSent: number;
  totalErrorsEncountered: number;
  lastActiveTime: number;
}

const STORAGE_KEY_EVENTS = 'luminara_telemetry_events';
const STORAGE_KEY_SUMMARY = 'luminara_telemetry_summary';
const STORAGE_KEY_GUEST_ID = 'luminara_guest_id';
const STORAGE_KEY_PLAN_STATE = 'luminara_telemetry_plan_state';
const SESSION_START_KEY = 'luminara_session_start_time';
const MAX_STORED_EVENTS = 100;
const SEVEN_DAYS_MS = 7 * 86_400_000;

interface StoredPlanLifecycleState {
  plan?: string;
  expiresAt?: number;
  warnedExpiringFor?: number;
  warnedExpiredFor?: number;
}

class ProductTelemetryEngine {
  private summary: TelemetryMetricsSummary;
  private sessionStartTime: number;
  private clientId: string;
  private currentView: string = '';
  private viewStartTime: number = Date.now();
  private planLifecycleState: StoredPlanLifecycleState = {};

  constructor() {
    this.summary = this.loadSummary();
    this.sessionStartTime = this.resolveSessionStart();
    this.clientId = this.resolveClientId();
    this.initSession();
  }

  private resolveClientId(): string {
    const fallbackId = `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem(STORAGE_KEY_GUEST_ID);
        if (stored && stored.trim().length >= 8) return stored.trim();
        const nextId =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? `anon_${crypto.randomUUID()}`
            : fallbackId;
        window.localStorage.setItem(STORAGE_KEY_GUEST_ID, nextId);
        return nextId;
      }
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const stored = window.sessionStorage.getItem(STORAGE_KEY_GUEST_ID);
        if (stored && stored.trim().length >= 8) return stored.trim();
        window.sessionStorage.setItem(STORAGE_KEY_GUEST_ID, fallbackId);
        return fallbackId;
      }
    } catch {
      // Fallback to in-memory ID
    }
    return fallbackId;
  }

  public getSessionId(): string {
    return this.clientId;
  }

  private resolveSessionStart(): number {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const stored = window.sessionStorage.getItem(SESSION_START_KEY);
        if (stored) {
          const parsed = Number(stored);
          if (!Number.isNaN(parsed) && parsed > 0) return parsed;
        }
        const now = Date.now();
        window.sessionStorage.setItem(SESSION_START_KEY, String(now));
        return now;
      }
    } catch {
      // Fallback
    }
    return Date.now();
  }

  private loadSummary(): TelemetryMetricsSummary {
    const defaultSummary: TelemetryMetricsSummary = {
      sessionCount: 1,
      firstSessionTime: Date.now(),
      timeToFirstValueMs: null,
      firstValueAction: null,
      onboardingCompleted: false,
      completedOnboardingSteps: [],
      totalAuditsRun: 0,
      totalChatsSent: 0,
      totalErrorsEncountered: 0,
      lastActiveTime: Date.now(),
    };

    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(STORAGE_KEY_SUMMARY);
        if (raw) {
          return { ...defaultSummary, ...JSON.parse(raw) };
        }
      }
    } catch {
      // Fallback
    }
    return defaultSummary;
  }

  private saveSummary(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY_SUMMARY, JSON.stringify(this.summary));
      }
    } catch {
      // Quota exceeded
    }
  }

  private initSession(): void {
    this.summary.lastActiveTime = Date.now();
    this.saveSummary();
  }

  public track(type: TelemetryEventType, data?: Record<string, any>): void {
    const event: TelemetryEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      timestamp: Date.now(),
      data,
    };

    // Store in local ring buffer
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(STORAGE_KEY_EVENTS);
        const events: TelemetryEvent[] = raw ? JSON.parse(raw) : [];
        events.push(event);
        if (events.length > MAX_STORED_EVENTS) {
          events.splice(0, events.length - MAX_STORED_EVENTS);
        }
        window.localStorage.setItem(STORAGE_KEY_EVENTS, JSON.stringify(events));
      }
    } catch {
      // Ignore
    }

    // Update aggregated summary metrics
    if (type === 'error_encountered') {
      this.summary.totalErrorsEncountered += 1;
      this.saveSummary();
    }

    this.enqueueServerFlush(event);
  }

  private pendingFlush: TelemetryEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private enqueueServerFlush(event: TelemetryEvent): void {
    if (typeof window === 'undefined') return;
    this.pendingFlush.push(event);
    if (this.pendingFlush.length >= 8) {
      void this.flushToServer();
      return;
    }
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushToServer();
    }, 4000);
  }

  /** Best-effort POST to Worker product analytics (no PII keys). */
  public async flushToServer(): Promise<void> {
    if (typeof window === 'undefined') return;
    const batch = this.pendingFlush.splice(0, 40);
    if (!batch.length) return;
    try {
      const { apiBase, workerFetchWithAuthRetry } = await import('../apiClient');
      const base = apiBase();
      if (!base) return;
      await workerFetchWithAuthRetry(`${base}/api/analytics/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.clientId,
          events: batch.map((e) => ({
            type: e.type,
            path: typeof e.data?.view === 'string' ? e.data.view : undefined,
            data: e.data,
            timestamp: e.timestamp,
          })),
        }),
      });
    } catch {
      // Re-queue once on failure (cap)
      this.pendingFlush = [...batch.slice(0, 20), ...this.pendingFlush].slice(0, 40);
    }
  }

  /** Record view transition & calculate time spent on previous view */
  public trackPageView(viewName: string): void {
    const now = Date.now();
    const durationMs = this.currentView ? now - this.viewStartTime : 0;

    this.track('page_view', {
      view: viewName,
      previousView: this.currentView || null,
      timeSpentPreviousMs: durationMs,
    });

    this.currentView = viewName;
    this.viewStartTime = now;
  }

  /**
   * Time-To-First-Value (TTFV)
   * Triggered when a user completes their first successful audit or receives their first chat answer.
   */
  public recordFirstValue(actionName: 'audit' | 'chat' | string): void {
    if (actionName === 'audit') {
      this.summary.totalAuditsRun += 1;
    } else if (actionName === 'chat') {
      this.summary.totalChatsSent += 1;
    }

    if (this.summary.timeToFirstValueMs === null) {
      const durationMs = Math.max(0, Date.now() - this.sessionStartTime);
      this.summary.timeToFirstValueMs = durationMs;
      this.summary.firstValueAction = actionName;
      this.track('time_to_first_value', {
        action: actionName,
        durationMs,
        durationSeconds: Math.round(durationMs / 1000),
      });
    }

    this.track('core_action_completed', { action: actionName });
    this.saveSummary();
  }

  /** Onboarding funnel step progress */
  public recordOnboardingStep(stepId: string): void {
    if (!this.summary.completedOnboardingSteps.includes(stepId)) {
      this.summary.completedOnboardingSteps.push(stepId);
      this.track('onboarding_step_completed', {
        stepId,
        totalCompleted: this.summary.completedOnboardingSteps.length,
      });

      // 3 core steps: 'quick_scout', 'business_dna', 'brand_memory'
      if (this.summary.completedOnboardingSteps.length >= 3 && !this.summary.onboardingCompleted) {
        this.summary.onboardingCompleted = true;
        this.track('onboarding_completed', {
          timeFromStartMs: Date.now() - this.sessionStartTime,
        });
      }
      this.saveSummary();
    }
  }

  /** Record an encountered error with context */
  public recordError(component: string, message: string, fatal: boolean = false): void {
    this.track('error_encountered', {
      component,
      message: message.slice(0, 200),
      fatal,
    });
  }

  /** Record funnel drop-off */
  public recordFunnelAbandoned(funnel: string, stage: string, reason?: string): void {
    this.track('funnel_abandoned', {
      funnel,
      stage,
      reason,
    });
  }

  /** Record when an unsaved draft was restored to eliminate friction */
  public recordDraftRestored(field: string): void {
    this.track('draft_restored', { field });
  }

  /**
   * Checks paid subscription lifecycle transitions and emits deduplicated
   * `plan_expiring` (<= 7 days left) or `plan_expired` events.
   */
  public checkPlanLifecycle(
    plan?: string,
    expiresAt?: number,
    now: number = Date.now(),
  ): 'expiring' | 'expired' | null {
    const planNorm = String(plan || 'free').trim().toLowerCase();
    const isPaid = Boolean(planNorm && planNorm !== 'free');
    let prev: StoredPlanLifecycleState = { ...this.planLifecycleState };
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(STORAGE_KEY_PLAN_STATE);
        if (raw) prev = { ...prev, ...(JSON.parse(raw) as StoredPlanLifecycleState) };
      }
    } catch {
      // Keep in-memory state
    }

    const saveState = (next: StoredPlanLifecycleState) => {
      this.planLifecycleState = { ...next };
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(STORAGE_KEY_PLAN_STATE, JSON.stringify(next));
        }
      } catch {
        // Ignore storage errors
      }
    };

    if (typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt > 0) {
      if (expiresAt <= now) {
        if (prev.warnedExpiredFor !== expiresAt) {
          saveState({
            ...prev,
            plan: isPaid ? planNorm : prev.plan || planNorm,
            expiresAt,
            warnedExpiredFor: expiresAt,
          });
          this.track('plan_expired', { plan: isPaid ? planNorm : prev.plan || planNorm, expiresAt });
          return 'expired';
        }
        return null;
      }
      if (isPaid && expiresAt - now <= SEVEN_DAYS_MS) {
        if (prev.warnedExpiringFor !== expiresAt) {
          saveState({
            ...prev,
            plan: planNorm,
            expiresAt,
            warnedExpiringFor: expiresAt,
          });
          const daysLeft = Math.max(1, Math.ceil((expiresAt - now) / 86_400_000));
          this.track('plan_expiring', { plan: planNorm, expiresAt, daysLeft });
          return 'expiring';
        }
        return null;
      }
    }

    if (!isPaid && prev.plan && prev.plan !== 'free') {
      const marker = prev.expiresAt || -1;
      if (prev.warnedExpiredFor !== marker) {
        saveState({
          ...prev,
          plan: 'free',
          warnedExpiredFor: marker,
        });
        this.track('plan_expired', { plan: prev.plan, expiresAt: prev.expiresAt ?? null });
        return 'expired';
      }
      return null;
    }

    if (isPaid) {
      saveState({
        ...prev,
        plan: planNorm,
        expiresAt: typeof expiresAt === 'number' ? expiresAt : prev.expiresAt,
      });
    }
    return null;
  }

  /** Record Sean Ellis PMF / user disappointment survey response */
  public recordSurveyAnswer(
    disappointment: 'very_disappointed' | 'somewhat_disappointed' | 'not_disappointed',
    feedback?: string,
  ): void {
    this.track('survey_answered', {
      disappointment,
      feedback: feedback ? feedback.slice(0, 500) : undefined,
    });
  }

  public getSummary(): TelemetryMetricsSummary {
    return { ...this.summary };
  }

  /** Testing helper */
  public resetForTesting(): void {
    this.summary = {
      sessionCount: 1,
      firstSessionTime: Date.now(),
      timeToFirstValueMs: null,
      firstValueAction: null,
      onboardingCompleted: false,
      completedOnboardingSteps: [],
      totalAuditsRun: 0,
      totalChatsSent: 0,
      totalErrorsEncountered: 0,
      lastActiveTime: Date.now(),
    };
    this.sessionStartTime = Date.now();
    this.planLifecycleState = {};
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(STORAGE_KEY_EVENTS);
        window.localStorage.removeItem(STORAGE_KEY_SUMMARY);
        window.localStorage.removeItem(STORAGE_KEY_PLAN_STATE);
      }
    } catch {
      // Ignore
    }
  }
}

export const productTelemetry = new ProductTelemetryEngine();
