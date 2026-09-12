/**
 * Product Telemetry & Retention Tracking Engine
 * Tracks user friction, onboarding completion, drop-off funnels, and Time-to-First-Value (TTFV).
 * 100% Privacy-First: All telemetry is stored locally in localStorage by default.
 * Zero external ad tracking or PII leakage.
 */

export type TelemetryEventType =
  | 'session_started'
  | 'page_view'
  | 'onboarding_started'
  | 'onboarding_step_completed'
  | 'onboarding_completed'
  | 'time_to_first_value'
  | 'core_action_completed'
  | 'error_encountered'
  | 'funnel_abandoned'
  | 'draft_restored';

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
const SESSION_START_KEY = 'luminara_session_start_time';
const MAX_STORED_EVENTS = 100;

class ProductTelemetryEngine {
  private summary: TelemetryMetricsSummary;
  private sessionStartTime: number;
  private currentView: string = '';
  private viewStartTime: number = Date.now();

  constructor() {
    this.summary = this.loadSummary();
    this.sessionStartTime = this.resolveSessionStart();
    this.initSession();
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
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(STORAGE_KEY_EVENTS);
        window.localStorage.removeItem(STORAGE_KEY_SUMMARY);
      }
    } catch {
      // Ignore
    }
  }
}

export const productTelemetry = new ProductTelemetryEngine();
