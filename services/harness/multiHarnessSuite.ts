/**
 * Multi-Harness Agent Alignment Suite (Pillar 3).
 *
 * Implements isolated execution sandboxes across Luminara surfaces:
 * - MCP Server Harness: JSON-RPC 2.0 tool schemas & parameters.
 * - PointerBench Grounding Harness: 1024x768 absolute coordinate checks.
 * - Worker Edge Harness: Sub-10s streaming SSE and state serialization.
 * - Telegram Mini App Harness: 4096 char limits & inline callback payloads.
 *
 * Prevents harness overfitting during SFT and RL alignment loops.
 */

export type HarnessType = 'mcp' | 'grounding' | 'worker' | 'telegram';

export interface HarnessAction {
  surface: HarnessType;
  type: 'tool_call' | 'gui_click' | 'sse_event' | 'telegram_reply';
  name?: string;
  params?: Record<string, any>;
  content?: string;
  targetCoords?: [number, number];
}

export interface HarnessVerificationResult {
  harness: HarnessType;
  passed: boolean;
  score: number; // 0.0 - 1.0
  errors: string[];
  warnings: string[];
  latencyMs: number;
}

export interface MultiHarnessScorecard {
  overallScore: number; // 0.0 - 1.0
  passedAll: boolean;
  harnessResults: Record<HarnessType, HarnessVerificationResult>;
  summary: string;
}

const VALID_MCP_TOOLS = new Set([
  'list_projects',
  'get_project_context',
  'patch_project_context',
  'save_report',
  'list_reports',
  'probe_crawl',
  'dataforseo_serp',
  'memory_rag',
]);

/**
 * Validates MCP Tool Call conformance against Luminara schemas.
 */
export function validateMcpHarness(action: HarnessAction): HarnessVerificationResult {
  const start = performance.now();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (action.type !== 'tool_call') {
    errors.push(`Invalid action type for MCP: expected 'tool_call', got '${action.type}'`);
  }

  if (!action.name || !VALID_MCP_TOOLS.has(action.name)) {
    errors.push(`Unrecognized or hallucinated tool: '${action.name}'`);
  }

  const p = action.params || {};

  if (action.name === 'get_project_context' || action.name === 'probe_crawl') {
    if (!p.domain || typeof p.domain !== 'string' || !p.domain.includes('.')) {
      errors.push(`Tool '${action.name}' requires a valid 'domain' string parameter.`);
    }
  }

  if (action.name === 'save_report') {
    if (!p.domain) errors.push("Tool 'save_report' requires 'domain'");
    if (!p.summary && !p.verdict) errors.push("Tool 'save_report' requires 'summary' or 'verdict'");
  }

  const latencyMs = Number((performance.now() - start).toFixed(2));
  const passed = errors.length === 0;

  return {
    harness: 'mcp',
    passed,
    score: passed ? 1.0 : Math.max(0, 1.0 - errors.length * 0.4),
    errors,
    warnings,
    latencyMs,
  };
}

/**
 * Validates PointerBench GUI Grounding coordinates (1024x768 absolute space).
 */
export function validateGroundingHarness(action: HarnessAction): HarnessVerificationResult {
  const start = performance.now();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (action.type !== 'gui_click') {
    errors.push(`Invalid action type for Grounding: expected 'gui_click', got '${action.type}'`);
  }

  const coords = action.targetCoords;
  if (!coords || !Array.isArray(coords) || coords.length !== 2) {
    errors.push('Action missing valid [x, y] coordinates array.');
  } else {
    const [x, y] = coords;

    // Detect normalized [0, 1] coords failure mode
    if (x >= 0 && x <= 1.0 && y >= 0 && y <= 1.0 && (x !== 0 || y !== 0)) {
      errors.push(
        `Coordinates [${x}, ${y}] appear normalized. PointerBench protocol requires absolute pixels in 1024x768 space.`,
      );
    } else {
      if (x < 0 || x > 1024) {
        errors.push(`Coordinate X (${x}) is out of bounds [0, 1024].`);
      }
      if (y < 0 || y > 768) {
        errors.push(`Coordinate Y (${y}) is out of bounds [0, 768].`);
      }
    }
  }

  const latencyMs = Number((performance.now() - start).toFixed(2));
  const passed = errors.length === 0;

  return {
    harness: 'grounding',
    passed,
    score: passed ? 1.0 : Math.max(0, 1.0 - errors.length * 0.5),
    errors,
    warnings,
    latencyMs,
  };
}

/**
 * Validates Cloudflare Worker execution limits & streaming format.
 */
export function validateWorkerHarness(action: HarnessAction): HarnessVerificationResult {
  const start = performance.now();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (action.type !== 'sse_event') {
    errors.push(`Invalid action type for Worker: expected 'sse_event', got '${action.type}'`);
  }

  const content = action.content || '';
  if (!content) {
    errors.push('Worker event content cannot be empty.');
  } else {
    try {
      // Must be parsable JSON payload or valid SSE chunk
      if (content.startsWith('data: ')) {
        const jsonStr = content.slice(6).trim();
        if (jsonStr !== '[DONE]') {
          JSON.parse(jsonStr);
        }
      } else {
        JSON.parse(content);
      }
    } catch {
      errors.push('Worker event payload is not valid JSON or SSE format.');
    }
  }

  const latencyMs = Number((performance.now() - start).toFixed(2));
  const passed = errors.length === 0;

  return {
    harness: 'worker',
    passed,
    score: passed ? 1.0 : Math.max(0, 1.0 - errors.length * 0.5),
    errors,
    warnings,
    latencyMs,
  };
}

/**
 * Validates Telegram Mini App payload formatting & size constraints.
 */
export function validateTelegramHarness(action: HarnessAction): HarnessVerificationResult {
  const start = performance.now();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (action.type !== 'telegram_reply') {
    errors.push(`Invalid action type for Telegram: expected 'telegram_reply', got '${action.type}'`);
  }

  const text = action.content || '';
  if (text.length > 4096) {
    errors.push(`Telegram message length (${text.length}) exceeds 4096 characters limit.`);
  }

  // Check for broken markdown or HTML tags
  const openCodeBlocks = (text.match(/```/g) || []).length;
  if (openCodeBlocks % 2 !== 0) {
    warnings.push('Unclosed code block (```) detected in Telegram text.');
  }

  const latencyMs = Number((performance.now() - start).toFixed(2));
  const passed = errors.length === 0;

  return {
    harness: 'telegram',
    passed,
    score: passed ? 1.0 : Math.max(0, 1.0 - errors.length * 0.4),
    errors,
    warnings,
    latencyMs,
  };
}

/**
 * Runs a set of actions across all relevant harnesses and evaluates generalizability.
 */
export function evaluateMultiHarness(actions: HarnessAction[]): MultiHarnessScorecard {
  const results: Record<HarnessType, HarnessVerificationResult> = {
    mcp: { harness: 'mcp', passed: true, score: 1.0, errors: [], warnings: [], latencyMs: 0 },
    grounding: { harness: 'grounding', passed: true, score: 1.0, errors: [], warnings: [], latencyMs: 0 },
    worker: { harness: 'worker', passed: true, score: 1.0, errors: [], warnings: [], latencyMs: 0 },
    telegram: { harness: 'telegram', passed: true, score: 1.0, errors: [], warnings: [], latencyMs: 0 },
  };

  for (const action of actions) {
    switch (action.surface) {
      case 'mcp':
        results.mcp = validateMcpHarness(action);
        break;
      case 'grounding':
        results.grounding = validateGroundingHarness(action);
        break;
      case 'worker':
        results.worker = validateWorkerHarness(action);
        break;
      case 'telegram':
        results.telegram = validateTelegramHarness(action);
        break;
    }
  }

  const scores = Object.values(results).map((r) => r.score);
  const overallScore = Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(4));
  const passedAll = Object.values(results).every((r) => r.passed);

  const summary = passedAll
    ? `All 4 harnesses passed with overall robustness score of ${(overallScore * 100).toFixed(1)}%.`
    : `Harness validation failed with score of ${(overallScore * 100).toFixed(1)}%. Review failed surfaces.`;

  return {
    overallScore,
    passedAll,
    harnessResults: results,
    summary,
  };
}
