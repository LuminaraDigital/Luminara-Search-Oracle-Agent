/** Parse typical DataForSEO live task envelopes (isomorphic). */

export function dfsFirstResult(body: unknown): unknown {
  if (!body || typeof body !== 'object') return null;
  const tasks = (body as { tasks?: unknown[] }).tasks;
  if (!Array.isArray(tasks) || !tasks.length) return null;
  const first = tasks[0] as { result?: unknown; status_code?: number; status_message?: string };
  if (typeof first.status_code === 'number' && first.status_code >= 40000) {
    return { _dfsTaskError: true, status_code: first.status_code, status_message: first.status_message };
  }
  return first.result ?? null;
}
