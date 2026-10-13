// #259 OS3a: share the KV binding for storage stores between the hosted entry
// (index.ts) and the billing-free core entry (core.ts). Degraded-without-KV
// contract lives **only here**:
//
//   1. injected deps.store (tests) wins when present
//   2. else KV when UMEBOSHI_KV is bound
//   3. else undefined = caller returns 500 "~not configured"
//
// Self-host users without KV get chat/models only; threads/settings/panel
// lookup return 500 and the panel falls back to local settings (degraded
// contract defined in OS3a). allowlist/inventory cache/purge stay hosted-only,
// so modelStoreFor remains in index.ts.
//
// #262 OS4a: moved the auth-code storage surface (AuthStore) and its impls
// (kvStore/memoryStore) here from the hosted-only auth.ts. Core never imports
// auth.ts, so it cannot physically reach the login-auth implementation.
import type { ThreadStore } from "./threads";

/** Surface storing settings, the hosted ledger, and auth codes. */
export interface AuthStore {
  get(key: string): Promise<string | null>;
  /** Writes without ttlSec never expire (for one-off hosted ledger entries). */
  put(key: string, value: string, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
}

/** KV-bound AuthStore implementation. */
export function kvStore(kv: KVNamespace): AuthStore {
  return {
    get: (k) => kv.get(k),
    put: (k, v, ttlSec) => kv.put(k, v, ttlSec === undefined ? undefined : { expirationTtl: ttlSec }),
    del: (k) => kv.delete(k),
  };
}

// Test/KV-less dev store. Enforce TTL on get (like KV expirationTtl).
export function memoryStore(): AuthStore {
  const map = new Map<string, { value: string; exp: number }>();
  return {
    get: async (k) => {
      const e = map.get(k);
      if (!e) return null;
      if (Date.now() >= e.exp) {
        map.delete(k);
        return null;
      }
      return e.value;
    },
    put: async (k, v, ttlSec) => {
      const exp = ttlSec === undefined ? Number.POSITIVE_INFINITY : Date.now() + ttlSec * 1000;
      map.set(k, { value: v, exp });
    },
    del: async (k) => {
      map.delete(k);
    },
  };
}

/** Store injection point. Hosted Deps and core CoreDeps satisfy this same shape. */
export interface StoreDeps {
  store?: AuthStore;
}

/** KV binding surface. Hosted Env and core CoreEnv satisfy this same shape. */
export interface StoreEnv {
  UMEBOSHI_KV?: KVNamespace;
}

/**
 * Store for settings, the hosted ledger, and auth codes. Unbound is undefined
 * (caller returns 500 auth store not configured / billing_unavailable).
 */
export function authStoreFor(deps: StoreDeps, env: StoreEnv): AuthStore | undefined {
  if (deps.store) return deps.store;
  if (env.UMEBOSHI_KV) return kvStore(env.UMEBOSHI_KV);
  return undefined;
}

/**
 * S6: Thread body/index live in durable KV. An injected deps.store wraps a
 * TTL AuthStore as durable (10-year TTL avoids test memoryStore expiry).
 */
export function threadStoreFor(deps: StoreDeps, env: StoreEnv): ThreadStore | undefined {
  if (deps.store) {
    const s = deps.store;
    return {
      get: (k) => s.get(k),
      put: (k, v) => s.put(k, v, 10 * 365 * 24 * 60 * 60),
      del: (k) => s.del(k),
    };
  }
  if (env.UMEBOSHI_KV) {
    const kv = env.UMEBOSHI_KV;
    return {
      get: (k) => kv.get(k),
      put: (k, v) => kv.put(k, v).then(() => undefined),
      del: (k) => kv.delete(k),
    };
  }
  return undefined;
}
