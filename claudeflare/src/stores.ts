// #259 OS3a: 保存系ストアの KV 束縛を、完全版入口 (index.ts) と課金なしの
// コア入口 (core.ts) で共有する。KV なしでの劣化契約は**ここ1箇所**が正:
//
//   1. deps.store の注入（テスト）があればそれ
//   2. 無くて UMEBOSHI_KV が束縛されていれば KV
//   3. どちらも無ければ undefined = 呼び出し側が 500「〜not configured」を返す
//
// 自己ホストで KV を束縛しない利用者は chat・models だけが動き、
// threads・settings・面板照会は 500 になって面板がローカル設定にフォールバック
// する（OS3a で定義した劣化契約）。allowlist・在庫キャッシュ・purge は
// 完全版だけの関心事なので modelStoreFor は index.ts に残している。
//
// #262 OS4a: 認証コードの保存断面 (AuthStore) とその実装 (kvStore・
// memoryStore) を auth.ts（完全版専用）からここへ移した。コア入口が
// auth.ts を import しないと、ログイン認証の実装へ物理的に到達できない。
import type { ThreadStore } from "./threads";

/** settings・課金台帳・認証コードを保存する断面。 */
export interface AuthStore {
  get(key: string): Promise<string | null>;
  /** ttlSec を省略した書き込みは期限なし（単発で買った credits 用）。 */
  put(key: string, value: string, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
}

/** KV 束縛の AuthStore 実装。 */
export function kvStore(kv: KVNamespace): AuthStore {
  return {
    get: (k) => kv.get(k),
    put: (k, v, ttlSec) => kv.put(k, v, ttlSec === undefined ? undefined : { expirationTtl: ttlSec }),
    del: (k) => kv.delete(k),
  };
}

// テスト・KV未束縛dev用。TTLはget時に強制する（KV expirationTtl相当）。
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

/** ストアの注入口。完全版の Deps・コアの CoreDeps が満たす同名断面。 */
export interface StoreDeps {
  store?: AuthStore;
}

/** KV の束縛口。完全版の Env・コアの CoreEnv が満たす同名断面。 */
export interface StoreEnv {
  UMEBOSHI_KV?: KVNamespace;
}

/**
 * settings・課金台帳・認証コードのストア。未束縛は undefined
 * （呼び出し側が 500 auth store not configured / billing_unavailable を返す）。
 */
export function authStoreFor(deps: StoreDeps, env: StoreEnv): AuthStore | undefined {
  if (deps.store) return deps.store;
  if (env.UMEBOSHI_KV) return kvStore(env.UMEBOSHI_KV);
  return undefined;
}

/**
 * S6: Thread本体・indexは永続KV。deps.store注入時はTTL付きAuthStoreを永続扱いで
 * 包む (テスト用memoryStoreのTTL満了を避けるため10年TTL)。
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
