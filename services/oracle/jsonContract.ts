/**
 * Structured JSON output contract with outermost span extraction and bounded 1-retry repair.
 *
 * Adapted from NousResearch/hermes-agent (`tools/delegation_output_schema.py`)
 * at commit ca2269588fd028adb41f3cc45875b04f3c0b88b4. Copyright (c) 2025 Nous Research (MIT).
 * Em dashes replaced with ASCII `-` to satisfy repository copy standards.
 */

export type JsonContractValidator<T> = (parsed: unknown) => { ok: true; value: T } | { ok: false; errors: string[] };

export type JsonValidationOutcome<T> =
  | { ok: true; value: T; errors: [] }
  | { ok: false; value: null; errors: string[] };

/** Append the explicit machine-validated output contract block to a prompt context. */
export function appendOutputContract(
  context: string | undefined,
  schema: Record<string, unknown> | string,
): string {
  const schemaText = typeof schema === 'string' ? schema : JSON.stringify(schema, null, 2);
  const block =
    'OUTPUT CONTRACT (machine-validated):\n' +
    'Your FINAL response must be ONLY the JSON value that validates against this JSON ' +
    'Schema - no prose before or after it, no code fence, no explanation. Anything else ' +
    'costs a correction turn and, if it fails again, falls back without unvalidated fields.\n' +
    schemaText;
  const base = (context || '').trimEnd();
  return base ? `${base}\n\n${block}` : block;
}

const EMBEDDED_FENCE_RE = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/i;
const INLINE_CITATION_MARKER_RE = /^\[\d+\]$/;

function collectBalancedSpans(input: string): Array<{ start: number; candidate: string }> {
  const results: Array<{ start: number; candidate: string }> = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch !== '{' && ch !== '[') {
      i += 1;
      continue;
    }
    const start = i;
    const stack: string[] = [ch === '{' ? '}' : ']'];
    let inString = false;
    let escaped = false;
    let j = i + 1;
    while (j < input.length && stack.length > 0) {
      const c = input[j];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (c === '\\') {
          escaped = true;
        } else if (c === '"') {
          inString = false;
        }
      } else if (c === '"') {
        inString = true;
      } else if (c === '{') {
        stack.push('}');
      } else if (c === '[') {
        stack.push(']');
      } else if (c === stack[stack.length - 1]) {
        stack.pop();
      }
      j += 1;
    }
    if (stack.length === 0) {
      results.push({ start, candidate: input.slice(start, j) });
      i = j;
    } else {
      i += 1;
    }
  }
  return results;
}

/**
 * Strip markdown fences and prose around the outermost `{...}` or `[...]`.
 * Evaluates embedded code fences first and skips inline `[1]` citation tokens when
 * a structured JSON value follows in prose.
 */
export function extractJsonCandidate(text: string): string {
  let raw = String(text || '').trim();
  if (raw.includes('```')) {
    const embeddedFence = EMBEDDED_FENCE_RE.exec(raw);
    if (embeddedFence?.[1]?.trim()) {
      raw = embeddedFence[1].trim();
    } else if (raw.startsWith('```')) {
      const newlineIdx = raw.indexOf('\n');
      raw = newlineIdx >= 0 ? raw.slice(newlineIdx + 1) : '';
      if (raw.trimEnd().endsWith('```')) {
        raw = raw.trimEnd().slice(0, -3);
      }
      raw = raw.trim();
      if (raw.toLowerCase().startsWith('json\n')) {
        raw = raw.slice(5).trim();
      }
    }
  }

  const spans = collectBalancedSpans(raw);
  const validCandidates: string[] = [];
  for (const { candidate } of spans) {
    try {
      JSON.parse(candidate);
      validCandidates.push(candidate);
    } catch {
      continue;
    }
  }
  if (validCandidates.length > 1) {
    const nonCitation = validCandidates.find((c) => !INLINE_CITATION_MARKER_RE.test(c));
    if (nonCitation) return nonCitation;
  }
  if (validCandidates.length > 0) return validCandidates[0];
  return spans.length > 0 ? spans[0].candidate : raw;
}

/** Validate raw model text against `validator`, bounding errors to at most 10 items. */
export function validateJsonContract<T>(
  text: string,
  validator: JsonContractValidator<T>,
): JsonValidationOutcome<T> {
  const candidate = extractJsonCandidate(text);
  if (!candidate.trim()) {
    return {
      ok: false,
      value: null,
      errors: ['Response was empty - expected a JSON value matching the output contract.'],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, value: null, errors: [`Response is not valid JSON: ${msg}`] };
  }
  const checked = validator(parsed);
  if (checked.ok) {
    return { ok: true, value: checked.value, errors: [] };
  }
  const bounded = checked.errors.slice(0, 10);
  return {
    ok: false,
    value: null,
    errors: bounded.length > 0 ? bounded : ['JSON did not satisfy the output contract.'],
  };
}

/** Single bounded retry message: verbatim validation errors, schema deliberately NOT re-pasted. */
export function buildSingleRetryMessage(errors: readonly string[]): string {
  const errorBlock = errors.slice(0, 10).map((e) => `- ${e}`).join('\n');
  return (
    'Your previous final response was rejected by the output contract validator. Validation errors:\n' +
    `${errorBlock}\n\n` +
    'Reply with ONLY the corrected JSON value matching the OUTPUT CONTRACT schema from your task context. ' +
    'No prose, no explanations.'
  );
}

/**
 * Execute `firstAttempt`, validate, and on failure run at most ONE bounded repair turn
 * carrying the verbatim validation errors.
 */
export async function runWithSingleJsonRetry<T>(params: {
  firstAttempt: () => Promise<string | null>;
  retryAttempt: (retryMessage: string, failedRaw: string) => Promise<string | null>;
  validator: JsonContractValidator<T>;
}): Promise<
  | { ok: true; value: T; retried: boolean; errors: [] }
  | { ok: false; value: null; retried: boolean; errors: string[] }
> {
  const firstRaw = await params.firstAttempt();
  if (firstRaw === null) {
    return { ok: false, value: null, retried: false, errors: ['Model returned no completion.'] };
  }
  const firstCheck = validateJsonContract(firstRaw, params.validator);
  if (firstCheck.ok) {
    return { ok: true, value: firstCheck.value, retried: false, errors: [] };
  }

  const retryPrompt = buildSingleRetryMessage(firstCheck.errors);
  const secondRaw = await params.retryAttempt(retryPrompt, firstRaw);
  if (secondRaw === null) {
    return {
      ok: false,
      value: null,
      retried: true,
      errors: [...firstCheck.errors, 'Retry returned empty/null completion.'],
    };
  }
  const secondCheck = validateJsonContract(secondRaw, params.validator);
  if (secondCheck.ok) {
    return { ok: true, value: secondCheck.value, retried: true, errors: [] };
  }
  return { ok: false, value: null, retried: true, errors: secondCheck.errors };
}
