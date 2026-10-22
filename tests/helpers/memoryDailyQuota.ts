import { DatabaseSync } from 'node:sqlite';
import { DailyQuota } from '../../worker/dailyQuota';

function cursor(rows: unknown[]) {
  return {
    next(): IteratorResult<unknown> {
      const value = rows.shift();
      if (value === undefined) return { done: true, value: undefined };
      return { done: false, value };
    },
    toArray: () => rows,
    [Symbol.iterator]: () => rows[Symbol.iterator](),
  };
}

function sqliteState(): DurableObjectState {
  const db = new DatabaseSync(':memory:');
  const sql = {
    exec(query: string, ...bindings: unknown[]) {
      if (/^\s*CREATE/i.test(query)) {
        db.exec(query);
        return cursor([]);
      }
      const rows = db.prepare(query).all(...(bindings as (string | number | null | bigint)[]));
      return cursor(rows);
    },
    get databaseSize() {
      return 0;
    },
  };
  return {
    storage: { sql },
    blockConcurrencyWhile(fn: () => Promise<void>) {
      return fn();
    },
  } as unknown as DurableObjectState;
}

/** In-process DailyQuota. One object per idFromName, same SQL as production. */
export function memoryDailyQuotaNamespace(): DurableObjectNamespace {
  const instances = new Map<string, DailyQuota>();
  return {
    idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
    get: (id: DurableObjectId) => {
      const key = id.toString();
      let inst = instances.get(key);
      if (!inst) {
        inst = new DailyQuota(sqliteState());
        instances.set(key, inst);
      }
      return {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          const req = input instanceof Request ? input : new Request(String(input), init);
          return inst.fetch(req);
        },
      } as unknown as DurableObjectStub;
    },
  } as unknown as DurableObjectNamespace;
}
