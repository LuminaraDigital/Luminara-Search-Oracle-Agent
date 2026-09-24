/**
 * Bounded predict / act / tick loop (Jev agent command contract, Luminara-shaped).
 * Caller owns browser I/O via observe + executeAct. Never retries a mutation.
 */
import { chooseWithLlm } from './choose';
import { fieldContext, fieldContextCacheKey, fieldTextWithLlm } from './fieldText';
import {
  DEFAULT_MAX_STEPS,
  StalePageError,
  type Decision,
  type ExecuteActFn,
  type HistoryEntry,
  type LlmFn,
  type LoopState,
  type ObserveFn,
  type ObservePayload,
} from './types';

export type BrowserActionLoopOptions = {
  goal: string;
  initialPage: ObservePayload;
  observe: ObserveFn;
  executeAct: ExecuteActFn;
  /** Optional freshness probe; when false, re-observe before predict/act. */
  isFresh?: (page: ObservePayload) => boolean | Promise<boolean>;
  chooseLlm?: LlmFn;
  fieldLlm?: LlmFn;
  /** Inject a decision instead of calling chooseLlm (tests). */
  chooseFn?: (
    page: ObservePayload,
    goal: string,
    history: HistoryEntry[],
  ) => Promise<Decision>;
  maxSteps?: number;
};

type PendingText = {
  key: string;
  text: string;
  helper: Record<string, unknown>;
};

export class BrowserActionLoop {
  readonly state: LoopState;
  private readonly observe: ObserveFn;
  private readonly executeAct: ExecuteActFn;
  private readonly isFresh?: (page: ObservePayload) => boolean | Promise<boolean>;
  private readonly chooseLlm?: LlmFn;
  private readonly fieldLlm?: LlmFn;
  private readonly chooseFn?: BrowserActionLoopOptions['chooseFn'];
  private pendingText: PendingText | null = null;
  private startedAt: number | null = null;

  constructor(opts: BrowserActionLoopOptions) {
    this.observe = opts.observe;
    this.executeAct = opts.executeAct;
    this.isFresh = opts.isFresh;
    this.chooseLlm = opts.chooseLlm;
    this.fieldLlm = opts.fieldLlm;
    this.chooseFn = opts.chooseFn;
    this.state = {
      goal: opts.goal,
      page: opts.initialPage,
      decision: null,
      history: [],
      status: 'ready',
      decisions: [],
      text_calls: [],
      maxSteps: opts.maxSteps ?? DEFAULT_MAX_STEPS,
      elapsed_ms: 0,
    };
  }

  private markElapsed(): void {
    if (this.startedAt != null) {
      this.state.elapsed_ms = Math.round(performance.now() - this.startedAt);
    }
  }

  private async ensureFreshPage(): Promise<void> {
    if (!this.isFresh) return;
    const fresh = await this.isFresh(this.state.page);
    if (!fresh) {
      this.state.page = await this.observe();
      this.markElapsed();
    }
  }

  async predict(): Promise<LoopState> {
    if (this.startedAt == null) this.startedAt = performance.now();
    if (this.state.status === 'done' || this.state.status === 'blocked') {
      throw new Error('This run has stopped. Start a fresh loop.');
    }
    if (this.state.decisions.length >= this.state.maxSteps * 2) {
      throw new Error("Reached the loop's model-call budget");
    }

    await this.ensureFreshPage();
    this.state.decision = null;

    let decision: Decision;
    if (this.chooseFn) {
      decision = await this.chooseFn(this.state.page, this.state.goal, this.state.history);
    } else if (this.chooseLlm) {
      decision = await chooseWithLlm(
        this.state.page,
        this.state.goal,
        this.state.history,
        this.chooseLlm,
      );
    } else {
      throw new Error('chooseFn or chooseLlm required for predict');
    }

    this.state.decision = decision;
    this.state.decisions.push(decision);
    this.state.status = 'predicted';
    this.markElapsed();
    return this.state;
  }

  /**
   * Execute the pending decision once. Consumes decision before any mutation
   * so a retry cannot double-act.
   */
  async act(expectedFingerprint?: string): Promise<LoopState> {
    const decision = this.state.decision;
    const page = this.state.page;
    const fingerprint = expectedFingerprint ?? page.fingerprint;

    if (!decision || fingerprint !== page.fingerprint) {
      throw new Error('Observe and choose before acting');
    }

    // Consume once, before any mutation or model call.
    this.state.decision = null;

    const selected = decision.choice;
    if (selected === 'DONE' || selected === 'BLOCKED') {
      await this.ensureFreshOrStale();
      this.state.status = selected === 'DONE' ? 'done' : 'blocked';
      this.markElapsed();
      return this.state;
    }

    if (this.state.history.length >= this.state.maxSteps) {
      this.state.status = 'blocked';
      throw new Error(`Stopped at the ${this.state.maxSteps}-action budget`);
    }

    const action = page.actions.find((a) => a.id === selected);
    if (!action) {
      throw new Error(`Unknown action id ${selected}; no action executed.`);
    }

    let text: string | undefined;
    let helper: Record<string, unknown> | null = null;

    if (action.kind === 'fill') {
      await this.ensureFreshOrStale();
      if (!this.fieldLlm && !this.pendingText) {
        // Allow pending cache hit without fieldLlm when context matches.
      }
      const context = fieldContext(this.state.goal, action, page, this.state.history);
      const key = fieldContextCacheKey(context);
      if (this.pendingText && this.pendingText.key === key) {
        text = this.pendingText.text;
        helper = this.pendingText.helper;
      } else {
        if (!this.fieldLlm) {
          throw new Error('TYPE_TEXT needs fieldLlm; no text is hardcoded or guessed by the executor.');
        }
        const result = await fieldTextWithLlm(context, this.fieldLlm);
        text = result.text;
        helper = { raw: result.raw };
        this.pendingText = { key, text, helper };
        this.state.text_calls.push({
          ...helper,
          field: action.label,
          value: text,
        });
      }
    }

    // Mutation: never retry. Caller executeAct must reject on stale fingerprint.
    const nextPage = await this.executeAct({
      actionId: selected,
      fingerprint: page.fingerprint,
      text,
    });

    this.pendingText = null;
    this.markElapsed();

    const entry: HistoryEntry = {
      step: this.state.history.length + 1,
      action: action.label,
      kind: action.kind,
      choice: selected,
      text: text ?? null,
      operation: decision.operation,
      target: decision.target,
      page_changed: null,
      url: page.url,
      confidence: decision.confidence,
      probability: decision.probabilities[selected],
    };
    this.state.history.push(entry);

    this.state.page = nextPage;
    this.markElapsed();
    entry.page_changed = nextPage.fingerprint !== page.fingerprint;
    entry.url = nextPage.url;

    const repeated = this.state.history.slice(-3);
    this.state.status =
      repeated.length === 3 &&
      repeated.every((h) => h.page_changed === false && h.kind !== 'wait')
        ? 'blocked'
        : 'ready';

    return this.state;
  }

  private async ensureFreshOrStale(): Promise<void> {
    if (!this.isFresh) return;
    const fresh = await this.isFresh(this.state.page);
    if (!fresh) {
      throw new StalePageError();
    }
  }

  /**
   * predict + act. On StalePageError, clear decision, re-observe, return ready.
   */
  async tick(): Promise<LoopState> {
    try {
      await this.predict();
      return await this.act(this.state.page.fingerprint);
    } catch (err) {
      if (err instanceof StalePageError) {
        this.state.decision = null;
        this.state.status = 'ready';
        this.state.page = await this.observe();
        this.markElapsed();
        return this.state;
      }
      throw err;
    }
  }

  /** Expose pending-text cache key for tests (null when empty). */
  getPendingTextCacheKey(): string | null {
    return this.pendingText?.key ?? null;
  }
}

/** Functional helpers matching the class surface. */
export async function predict(loop: BrowserActionLoop): Promise<LoopState> {
  return loop.predict();
}

export async function act(loop: BrowserActionLoop, fingerprint?: string): Promise<LoopState> {
  return loop.act(fingerprint);
}

export async function tick(loop: BrowserActionLoop): Promise<LoopState> {
  return loop.tick();
}
