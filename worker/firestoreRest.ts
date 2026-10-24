/**
 * Firestore REST client for Workers. No firebase-admin.
 * Document paths stay on firestore.googleapis.com. The project id is a checked token.
 */
import type { GcpTokenProvider } from './gcpToken';
import { tokenProviderFromEnv } from './gcpToken';
import type { DataPlaneDeps } from './dataPlane';
import type { DataPlaneEnv } from './dataPlaneDocs';

const PROJECT_ID = /^[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const COLLECTION = /^[A-Za-z][A-Za-z0-9]*$/;

type FsValue =
  | { nullValue: null }
  | { stringValue: string }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields?: Record<string, FsValue> } };

export type FirestoreDoc = { id: string; fields: Record<string, unknown> };

export type FirestoreClient = {
  get(collection: string, id: string, signal?: AbortSignal): Promise<Record<string, unknown> | null>;
  patch(
    collection: string,
    id: string,
    fields: Record<string, unknown>,
    opts?: { mask?: readonly string[]; signal?: AbortSignal },
  ): Promise<void>;
  query(
    input: { collection: string; accountId: string; domain?: string; limit: number; orderBy?: 'measuredAt' | 'accountId' },
    signal?: AbortSignal,
  ): Promise<FirestoreDoc[]>;
  delete(collection: string, id: string, signal?: AbortSignal): Promise<void>;
  batchDelete(collection: string, ids: readonly string[], signal?: AbortSignal): Promise<void>;
};

export function encodeValue(value: unknown): FsValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isSafeInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map((item) => encodeValue(item)) } };
  if (isRecord(value)) {
    const fields: Record<string, FsValue> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (inner === undefined) continue;
      fields[key] = encodeValue(inner);
    }
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}

export function encodeFields(fields: Record<string, unknown>): Record<string, FsValue> {
  const out: Record<string, FsValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    out[key] = encodeValue(value);
  }
  return out;
}

export function decodeValue(value: unknown): unknown {
  if (!isRecord(value)) return null;
  if ('nullValue' in value) return null;
  if (typeof value.stringValue === 'string') return value.stringValue;
  if (typeof value.booleanValue === 'boolean') return value.booleanValue;
  if (typeof value.integerValue === 'string') {
    const n = Number(value.integerValue);
    return Number.isSafeInteger(n) ? n : value.integerValue;
  }
  if (typeof value.doubleValue === 'number') return value.doubleValue;
  if (isRecord(value.arrayValue)) {
    const values = value.arrayValue.values;
    return Array.isArray(values) ? values.map((item) => decodeValue(item)) : [];
  }
  if (isRecord(value.mapValue)) return decodeFields(value.mapValue.fields);
  return null;
}

export function decodeFields(fields: unknown): Record<string, unknown> {
  if (!isRecord(fields)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) out[key] = decodeValue(value);
  return out;
}

export function createFirestoreClient(input: {
  project: string;
  tokenProvider: GcpTokenProvider;
  fetch: typeof fetch;
}): FirestoreClient {
  if (!PROJECT_ID.test(input.project)) throw new Error('invalid gcp project id');
  const base = `https://firestore.googleapis.com/v1/projects/${input.project}/databases/(default)/documents`;

  async function authed(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const token = await input.tokenProvider.getAccessToken();
    return input.fetch(url, {
      ...init,
      signal,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  }

  function resourceName(collection: string, id: string): string {
    if (!COLLECTION.test(collection) || !id || id.includes('/')) throw new Error('invalid firestore path');
    return `projects/${input.project}/databases/(default)/documents/${collection}/${encodeURIComponent(id)}`;
  }

  function docUrl(collection: string, id: string): string {
    return `https://firestore.googleapis.com/v1/${resourceName(collection, id)}`;
  }

  return {
    async get(collection, id, signal) {
      const response = await authed(docUrl(collection, id), { method: 'GET' }, signal);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`firestore ${response.status}`);
      const body = await response.json();
      if (!isRecord(body)) return {};
      return decodeFields(body.fields);
    },
    async patch(collection, id, fields, opts) {
      const url = new URL(docUrl(collection, id));
      for (const field of opts?.mask ?? []) url.searchParams.append('updateMask.fieldPaths', field);
      const response = await authed(url.toString(), {
        method: 'PATCH',
        body: JSON.stringify({ fields: encodeFields(fields) }),
      }, opts?.signal);
      if (!response.ok) throw new Error(`firestore ${response.status}`);
    },
    async query(query, signal) {
      const orderField = query.orderBy === 'accountId' ? 'accountId' : 'measuredAt';
      const response = await authed(`${base}:runQuery`, {
        method: 'POST',
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: query.collection }],
            where: where(query.accountId, query.domain),
            orderBy: [{ field: { fieldPath: orderField }, direction: orderField === 'accountId' ? 'ASCENDING' : 'DESCENDING' }],
            limit: query.limit,
          },
        }),
      }, signal);
      if (!response.ok) throw new Error(`firestore ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body)) return [];
      const docs: FirestoreDoc[] = [];
      for (const row of body) {
        if (!isRecord(row) || !isRecord(row.document)) continue;
        const name = row.document.name;
        if (typeof name !== 'string') continue;
        const id = decodeURIComponent(name.split('/').pop() ?? '');
        const fields = decodeFields(row.document.fields);
        if (id) docs.push({ id, fields });
      }
      return docs;
    },
    async delete(collection, id, signal) {
      const response = await authed(docUrl(collection, id), { method: 'DELETE' }, signal);
      if (response.status === 404) return;
      if (!response.ok) throw new Error(`firestore ${response.status}`);
    },
    async batchDelete(collection, ids, signal) {
      if (ids.length === 0) return;
      const writes = ids.map((id) => ({ delete: resourceName(collection, id) }));
      const response = await authed(`${base}:batchWrite`, {
        method: 'POST',
        body: JSON.stringify({ writes }),
      }, signal);
      if (!response.ok) throw new Error(`firestore ${response.status}`);
    },
  };
}

export function firestoreFromEnv(env: DataPlaneEnv, deps?: DataPlaneDeps): FirestoreClient | null {
  const project = (env.GCP_PROJECT_ID ?? '').trim();
  if (!PROJECT_ID.test(project)) return null;
  const fetchImpl = deps?.fetch ?? fetch;
  const tokenProvider = deps?.tokenProvider ?? tokenProviderFromEnv(env, fetchImpl);
  if (!tokenProvider) return null;
  return createFirestoreClient({ project, tokenProvider, fetch: fetchImpl });
}

function where(accountId: string, domain?: string): unknown {
  const account = fieldEquals('accountId', accountId);
  if (!domain) return account;
  return { compositeFilter: { op: 'AND', filters: [account, fieldEquals('domain', domain)] } };
}

function fieldEquals(fieldPath: string, value: string): unknown {
  return { fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: { stringValue: value } } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
