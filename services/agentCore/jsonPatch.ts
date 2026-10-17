/**
 * RFC 6902 JSON Patch Applier, Differ, and Copy-on-Write State Drafts.
 * Adapted from temporal-community/temporal-agent-harness (packages/client/src/jsonPatch.ts
 * and temporal_agent_harness/harness/state/drafts.py, MIT License,
 * Copyright (c) 2026 Temporal Technologies Inc.).
 *
 * Emits and applies only `add`, `replace`, and `remove` operations.
 * Never throws on malformed patches; reports where each operation landed (`resolved` pointer)
 * and guards against `__proto__` prototype pollution.
 * No em dashes in copy.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface JsonPatchOp {
  op: 'add' | 'replace' | 'remove';
  /** RFC 6901 pointer. `""` is the whole document; a trailing `/-` appends. */
  path: string;
  /** Absent on `remove`, and only on `remove`. */
  value?: JsonValue;
}

export interface AppliedOp {
  op: JsonPatchOp['op'];
  /** The pointer as it arrived (`/todos/-` and all). */
  path: string;
  /** Where it landed: `/todos/-` resolved against the array it appended to. */
  resolved: string;
  /** Absent on `remove`, which carries none. */
  value?: JsonValue;
  /** What stood at `resolved` beforehand. Absent where nothing did. */
  before?: JsonValue;
}

export interface PatchResult {
  ok: boolean;
  doc: JsonValue;
  applied: AppliedOp[];
  /**
   * The first op that could not be applied, named. Remaining ops are not
   * attempted because a patch is an ordered whole.
   */
  error: string | null;
}

export function escapeToken(token: string): string {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1');
}

export function unescapeToken(token: string): string {
  // `~1` first, then `~0` per RFC 6901 section 4.
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** `""` is the whole document, so it parses to no tokens rather than one empty token. */
export function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  return pointer.split('/').slice(1).map(unescapeToken);
}

export function buildPointer(tokens: Array<string | number>): string {
  return tokens.map((token) => `/${escapeToken(String(token))}`).join('');
}

function isContainer(node: unknown): node is JsonValue[] | Record<string, JsonValue> {
  return node !== null && typeof node === 'object';
}

const FORBIDDEN_POINTER_TOKENS = new Set(['__proto__', 'constructor', 'prototype']);
const STRICT_ARRAY_INDEX = /^(?:0|[1-9]\d*)$/;

/**
 * One step down a pointer, through the document's own keys only.
 * Guards against walking into `Object.prototype` via `__proto__`, `constructor`, or `prototype`.
 */
function child(node: JsonValue[] | Record<string, JsonValue>, token: string): JsonValue | undefined {
  if (FORBIDDEN_POINTER_TOKENS.has(token)) return undefined;
  if (Array.isArray(node)) {
    return STRICT_ARRAY_INDEX.test(token) ? node[Number(token)] : undefined;
  }
  return Object.hasOwn(node, token) ? node[token] : undefined;
}

/** The value at `pointer`, or undefined if nothing is there. */
export function valueAt(doc: JsonValue, pointer: string): JsonValue | undefined {
  let node: JsonValue | undefined = doc;
  for (const token of parsePointer(pointer)) {
    if (!isContainer(node)) return undefined;
    node = child(node, token);
  }
  return node;
}

/** Deep-clone a JSON value so mutations never write back into the source frame log. */
export function cloneJson<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function inserted(value: JsonValue | undefined): JsonValue {
  if (value === undefined || value === null) return null;
  return cloneJson(value);
}

/**
 * Apply `ops` in order.
 * Mutates `doc` in place when `doc` is a container, so pass a owned clone if immutability is needed.
 */
export function applyOps(doc: JsonValue, ops: readonly JsonPatchOp[]): PatchResult {
  let next = doc;
  const applied: AppliedOp[] = [];

  for (const op of ops) {
    if (op == null || typeof op.path !== 'string') {
      return { ok: false, doc: next, applied, error: 'a patch op arrived with no path' };
    }
    if (op.op !== 'add' && op.op !== 'replace' && op.op !== 'remove') {
      return {
        ok: false,
        doc: next,
        applied,
        error: `unsupported op ${JSON.stringify(op.op)} at ${op.path || '/'}`,
      };
    }
    if ((op.op === 'add' || op.op === 'replace') && (!('value' in op) || op.value === undefined)) {
      return {
        ok: false,
        doc: next,
        applied,
        error: `${op.op} ${op.path || '/'} requires a value`,
      };
    }

    const tokens = parsePointer(op.path);
    const forbiddenToken = tokens.find((t) => FORBIDDEN_POINTER_TOKENS.has(t));
    if (forbiddenToken) {
      return {
        ok: false,
        doc: next,
        applied,
        error: `${op.op} ${op.path} names ${forbiddenToken}`,
      };
    }

    if (tokens.length === 0) {
      if (op.op === 'remove') {
        return {
          ok: false,
          doc: next,
          applied,
          error: 'remove at root path "" is not permitted',
        };
      }
      applied.push({ op: op.op, path: op.path, resolved: '', before: next, value: op.value });
      next = inserted(op.value);
      continue;
    }

    const last = tokens.pop() as string;
    let parent: JsonValue | undefined = next;
    for (const token of tokens) {
      if (!isContainer(parent)) break;
      parent = child(parent, token);
    }
    if (!isContainer(parent)) {
      return {
        ok: false,
        doc: next,
        applied,
        error: `no container at ${buildPointer(tokens) || '/'} for ${op.op} ${op.path}`,
      };
    }

    let before: JsonValue | undefined;
    let landed: string | number = last;

    if (Array.isArray(parent)) {
      const isAppend = last === '-';
      const isValidIdx = isAppend || STRICT_ARRAY_INDEX.test(last);
      const index = isAppend ? parent.length : Number(last);
      const limit = op.op === 'add' ? parent.length : parent.length - 1;
      if (!isValidIdx || !Number.isInteger(index) || index < 0 || index > limit) {
        return {
          ok: false,
          doc: next,
          applied,
          error: `${op.op} ${op.path} is outside an array of ${parent.length}`,
        };
      }
      landed = index;
      if (op.op === 'add') {
        parent.splice(index, 0, inserted(op.value));
      } else if (op.op === 'replace') {
        before = parent[index];
        parent[index] = inserted(op.value);
      } else {
        before = parent[index];
        parent.splice(index, 1);
      }
    } else {
      before = child(parent, last);
      if (op.op === 'remove') {
        if (!Object.prototype.hasOwnProperty.call(parent, last)) {
          return { ok: false, doc: next, applied, error: `remove ${op.path} - no such key` };
        }
        delete parent[last];
      } else if (op.op === 'replace') {
        if (!Object.prototype.hasOwnProperty.call(parent, last)) {
          return { ok: false, doc: next, applied, error: `replace ${op.path} - no such key` };
        }
        parent[last] = inserted(op.value);
      } else {
        parent[last] = inserted(op.value);
      }
    }

    applied.push({
      op: op.op,
      path: op.path,
      resolved: buildPointer([...tokens, landed]),
      ...(op.op === 'remove' ? {} : { value: op.value }),
      ...(before === undefined ? {} : { before }),
    });
  }

  return { ok: true, doc: next, applied, error: null };
}

export const applyJsonPatch = applyOps;

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const recA = a as Record<string, unknown>;
  const recB = b as Record<string, unknown>;
  const keysA = Object.keys(recA).filter((k) => !FORBIDDEN_POINTER_TOKENS.has(k));
  const keysB = Object.keys(recB).filter((k) => !FORBIDDEN_POINTER_TOKENS.has(k));
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!Object.hasOwn(recB, k) || !deepEqual(recA[k], recB[k])) return false;
  }
  return true;
}

/**
 * Compute minimal RFC 6902 JSON Patch ops (`add`, `replace`, `remove`) transforming `prev` into `next`.
 */
export function diffJsonPatch(prev: unknown, next: unknown, basePath = ''): JsonPatchOp[] {
  if (deepEqual(prev, next)) return [];

  if (
    prev === null ||
    next === null ||
    typeof prev !== 'object' ||
    typeof next !== 'object' ||
    Array.isArray(prev) !== Array.isArray(next)
  ) {
    return [{ op: 'replace', path: basePath, value: cloneJson(next as JsonValue) }];
  }

  if (Array.isArray(prev) && Array.isArray(next)) {
    const ops: JsonPatchOp[] = [];
    const minLen = Math.min(prev.length, next.length);
    for (let i = 0; i < minLen; i++) {
      ops.push(...diffJsonPatch(prev[i], next[i], `${basePath}/${i}`));
    }
    if (next.length > prev.length) {
      for (let i = prev.length; i < next.length; i++) {
        ops.push({ op: 'add', path: `${basePath}/-`, value: cloneJson(next[i] as JsonValue) });
      }
    } else if (prev.length > next.length) {
      for (let i = prev.length - 1; i >= next.length; i--) {
        ops.push({ op: 'remove', path: `${basePath}/${i}` });
      }
    }
    return ops;
  }

  const ops: JsonPatchOp[] = [];
  const recPrev = prev as Record<string, unknown>;
  const recNext = next as Record<string, unknown>;
  const prevKeys = Object.keys(recPrev);
  const nextKeys = Object.keys(recNext);

  for (const k of prevKeys) {
    if (FORBIDDEN_POINTER_TOKENS.has(k)) continue;
    if (!Object.hasOwn(recNext, k) || recNext[k] === undefined) {
      ops.push({ op: 'remove', path: `${basePath}/${escapeToken(k)}` });
    }
  }
  for (const k of nextKeys) {
    if (FORBIDDEN_POINTER_TOKENS.has(k) || recNext[k] === undefined) continue;
    const childPath = `${basePath}/${escapeToken(k)}`;
    if (!Object.hasOwn(recPrev, k) || recPrev[k] === undefined) {
      ops.push({ op: 'add', path: childPath, value: cloneJson(recNext[k] as JsonValue) });
    } else {
      ops.push(...diffJsonPatch(recPrev[k], recNext[k], childPath));
    }
  }
  return ops;
}

export interface DraftMutationResult<T> {
  state: T;
  version: number;
  ops: JsonPatchOp[];
  dirty: boolean;
}

/**
 * Immer-style Copy-on-Write state mutator.
 * Runs `recipe` on a deep clone; if no modifications occurred (`ops.length === 0`),
 * returns the original reference untouched and does not increment `version`.
 */
export function mutateDraft<T>(
  currentState: T,
  currentVersion: number,
  recipe: (draft: T) => void,
): DraftMutationResult<T> {
  const draft = cloneJson(currentState);
  recipe(draft);
  const ops = diffJsonPatch(currentState, draft);
  if (ops.length === 0) {
    return {
      state: currentState,
      version: currentVersion,
      ops: [],
      dirty: false,
    };
  }
  return {
    state: draft,
    version: currentVersion + 1,
    ops,
    dirty: true,
  };
}
