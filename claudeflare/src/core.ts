// #259 OS3a: 課金のない Worker コア入口。完全版 (src/index.ts) の横に立つ
// 2本目の Worker エントリで、OSS として配る Worker 部分の元になる。
//
// 持つ route:
//   POST /api/ask/chat                       質問の中継（予約・精算・予算ガードなし）
//   GET  /api/ask/models                     モデル一覧（bundle 固定のみ）
//   GET  /api/ask/panel                      面板の版と停止旗の照会
//   GET  /api/ask/threads[...]               質問と解答の保存（Bearer必須）
//   GET|POST /api/settings                   設定の保存（Bearer必須）
//
// 持たないもの（問わないで404）:
//   課金 route（/api/billing/*・/billing・/api/usage）
//   ログイン認証 route（/api/auth/*・完全版 src/index.ts 専用）
//   モデル在庫の cron・allowlist・purge・匿名予算
//
// 認証は #255 OS2a のアクセストークン（env ASK_TOKEN）だけ。ログイン認証の
// 鍵は持たないので、Bearer が ASK_TOKEN と一致した request だけ threads・
// settings を保存できる（userId はトークンの SHA-256 ハッシュ）。不一致の
// Bearer は匿名に落とさず 401。Bearer が無い chat・models は匿名のまま通す。
//
// #262 OS4a: ログイン認証（外部IdP・署名付きトークン・20文字コード）は
// 完全版だけの実装 (src/auth.ts) に閉じ、この入口から import 到達できない。
// 認証の契約は共有の src/identity.ts が持ち、トークン検証器だけを完全版が
// 注入する（コアは渡さないので検証の経路自体が無い）。
//
// KV なしでの劣化契約（OS3a で定義。解答は src/stores.ts の1箇所）:
//   KV を束縛しない自己ホストでは chat・models は動く。settings は今日どおり
//   失敗扱い（面板はローカル設定にフォールバック）、threads の保存も失敗して
//   面板はローカルの写しのまま動く。匿名予算も無いので課金の話は出ない
//   （chat の done に charged を載せない）。
//
// #264 OS4b: hosted 運用の機構をコアから外す（完全版 src/index.ts は不変）。
//   - cors の許可ヘッダーは ALLOW_HEADERS_CORE。課金 webhook の署名ヘッダー
//     (Stripe-Signature) はコアに route が無いので載せない
//   - rate limit は掛けない（個人利用の最小構成。Cloudflare 側の制限に委ねる）。
//     ratelimit・IP ハッシュは export として残し、完全版の auth スコープが使う
//   - モデル一覧は bundle 固定のみ。allowlist・在庫キャッシュ・cron・purge は
//     完全版側。応答から credits（予約額）字段も落とす
//   - 匿名予算（二重鍵・JST バケット・クレジット換算）は完全版側。IP+UA ハッシュの
//     salt は ANON_SALT のみ（ログイン認証の鍵へのフォールバックは、コアに署名検証が
//     居なくなったので廃止）
//   - chat route は予約・精算・予算ガードを呼ばない（完全版は精算経路を自分の
//     entry が持つ）
import { handleChat } from "./chat";
import { MODEL_PRESETS, resolveModels } from "./models";
import { readPanelRelease } from "./panel";
import { getSettings, putSettings, SETTINGS_MAX_BYTES } from "./settings";
import { authStoreFor, threadStoreFor } from "./stores";
import { ALLOW_HEADERS_CORE, corsHeadersFor, withCors } from "./cors";
import { needLoginJson, resolveIdentity, storageUserId } from "./identity";
import type { AuthStore } from "./stores";
import {
  cardIdMismatch,
  deleteMessage,
  getThread,
  getThreadIndex,
  isValidCardId,
  patchMessage,
  postMessage,
} from "./threads";

/**
 * コアの CORS 応答。許可ヘッダーは ALLOW_HEADERS_CORE（課金 webhook の署名
 * ヘッダー Stripe-Signature を載せない・#264 OS4b）。完全版は cors.ts の既定
 * (ALLOW_HEADERS) をそのまま使うので、hosted の挙動は変わらない。
 *
 * 入口の全 route がこの1枚を通す（20 以上の呼び口が lockstep で要るので
 * 関数に束ねる。1箇所でも withCors を直に呼ぶと署名ヘッダーが復る）。
 */
function coreCors(request: Request, response: Response): Response {
  return withCors(request, response, ALLOW_HEADERS_CORE);
}

/** コア入口の env。課金・ログイン認証に要る鍵は持たない。 */
export interface CoreEnv {
  // OpenRouterキー。未設定のchatは503で明示する。
  OPENROUTER_API_KEY?: string;
  // #255 OS2a: 自己ホスト Worker のアクセストークン（任意・1本）。
  // 設定すると Bearer がこれと一致したリクエストだけ threads・settings を
  // 保存できる（userId はトークンの SHA-256 ハッシュ。生値は保存しない）。
  // 未設定なら Bearer は匿名として扱い、chat・models は従来どおり動く。
  ASK_TOKEN?: string;
  // 保存用KV（任意）。束縛しなければ threads・settings・面板照会は失敗扱い。
  UMEBOSHI_KV?: KVNamespace;
}

/** コア入口の deps（テスト注入用）。完全版の Deps の保存・chat 関連だけ。 */
export interface CoreDeps {
  store?: AuthStore;
  fetchFn?: typeof fetch;
  /** テスト注入用 (S9無音切替のdeadline上書きms)。未指定時はSILENCE_TIMEOUT_MS。 */
  chatTimeoutMs?: number;
}

/**
 * コア入口の HTTP 処理。持つ route だけが応答し、他は 404。
 *
 * chat は完全版のように予約・精算・予算ガードを刺さない。credits の概念を
 * まるごと持たないので、onSettled・chargedFor は渡さず、done に charged を
 * 載せない（面板は charged が無ければ消費表示を出さない）。
 */
export async function handleCoreRequest(
  request: Request,
  env: CoreEnv,
  deps: CoreDeps = {},
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeadersFor(request, ALLOW_HEADERS_CORE) });
  }
  // モデル一覧は bundle 固定のみ。allowlist・在庫キャッシュを持たないので
  // store は渡さない（KV を束縛しても一覧は bundle のまま）。
  if (request.method === "GET" && url.pathname === "/api/ask/models") {
    const resolved = await resolveModels(undefined);
    return coreCors(
      request,
      Response.json({
        // #264 OS4b: credits（予約額）は課金の額面。コアは credits の概念を
        // 持たないので一覧から落とす（OS6b の境界ガードの前提）。
        models: resolved.models.map((m) => {
          const bare = { ...m };
          delete bare.credits;
          return bare;
        }),
        presets: MODEL_PRESETS,
        source: resolved.source,
        ...(resolved.updatedAt ? { updatedAt: resolved.updatedAt } : {}),
      }),
    );
  }
  // UM1 (#183/spec #188): panel の版と停止旗の照会口。認証なし・本文なし。
  // KV を束縛しない自己ホストは版も旗も持たないので unavailable を返す。
  if (request.method === "GET" && url.pathname === "/api/ask/panel") {
    const release = await readPanelRelease(authStoreFor(deps, env));
    if (!release) {
      return coreCors(request, Response.json({ unavailable: true }));
    }
    return coreCors(
      request,
      Response.json({
        version: release.version,
        stopped: release.stopped,
        ...(release.updatedAt ? { updatedAt: release.updatedAt } : {}),
      }),
    );
  }
  // #259 OS3a: 課金の話をしない chat。identity は誤 token のときだけ 401 に使い、
  // 匿名予算・ユーザー予算・精算は呼ばない。
  if (request.method === "POST" && url.pathname === "/api/ask/chat") {
    const identity = await resolveIdentity(request, env);
    if (identity.kind === "unauthorized") {
      return needLoginJson(request, 401, "unauthorized");
    }
    const resolved = await resolveModels(undefined);
    const chatRes = await handleChat(request, env, deps.fetchFn ?? fetch, {
      models: resolved.models,
      ...(deps.chatTimeoutMs === undefined ? {} : { timeoutMs: deps.chatTimeoutMs }),
    });
    return coreCors(request, chatRes);
  }
  // S6: Thread保存 (Message単位・titleなし・thinkingなし)。認証はアクセス
  // トークンのみ。匿名・誤 token は401＋needLogin、KV 未束縛は500。
  // 照合: x-card-idヘッダ不一致400・所有者不一致403 (threads.ts側)。
  if (url.pathname === "/api/ask/threads" && request.method === "GET") {
    const userId = await storageUserId(request, env);
    if (!userId) return needLoginJson(request, 401, "unauthorized");
    const store = threadStoreFor(deps, env);
    if (!store) {
      return coreCors(request, Response.json({ error: "thread store not configured" }, { status: 500 }));
    }
    const r = await getThreadIndex(store, userId);
    return coreCors(request, Response.json(r.body, { status: r.status }));
  }
  {
    const mThread = url.pathname.match(/^\/api\/ask\/threads\/([^/]+)$/);
    if (mThread && request.method === "GET") {
      const userId = await storageUserId(request, env);
      if (!userId) return needLoginJson(request, 401, "unauthorized");
      const store = threadStoreFor(deps, env);
      if (!store) {
        return coreCors(request, Response.json({ error: "thread store not configured" }, { status: 500 }));
      }
      const cardId = decodeURIComponent(mThread[1] || "");
      if (cardIdMismatch(request.headers.get("x-card-id"), cardId)) {
        return coreCors(request, Response.json({ error: "cardId_mismatch" }, { status: 400 }));
      }
      const r = await getThread(store, userId, cardId);
      return coreCors(request, Response.json(r.body, { status: r.status }));
    }
  }
  {
    const mPost = url.pathname.match(/^\/api\/ask\/threads\/([^/]+)\/messages$/);
    if (mPost && request.method === "POST") {
      const userId = await storageUserId(request, env);
      if (!userId) return needLoginJson(request, 401, "unauthorized");
      const store = threadStoreFor(deps, env);
      if (!store) {
        return coreCors(request, Response.json({ error: "thread store not configured" }, { status: 500 }));
      }
      const cardId = decodeURIComponent(mPost[1] || "");
      if (!isValidCardId(cardId)) {
        return coreCors(request, Response.json({ error: "invalid_cardId" }, { status: 400 }));
      }
      if (cardIdMismatch(request.headers.get("x-card-id"), cardId)) {
        return coreCors(request, Response.json({ error: "cardId_mismatch" }, { status: 400 }));
      }
      let body: { cardId?: unknown; question?: unknown; answer?: unknown } | null = null;
      try {
        body = (await request.json()) as { cardId?: unknown; question?: unknown; answer?: unknown };
      } catch {
        return coreCors(request, Response.json({ error: "invalid_json" }, { status: 400 }));
      }
      if (body && body.cardId !== undefined && body.cardId !== cardId) {
        return coreCors(request, Response.json({ error: "cardId_mismatch" }, { status: 400 }));
      }
      const r = await postMessage(store, userId, cardId, body?.question, body?.answer);
      return coreCors(request, Response.json(r.body, { status: r.status }));
    }
  }
  {
    const mMsg = url.pathname.match(/^\/api\/ask\/threads\/([^/]+)\/messages\/([^/]+)$/);
    if (mMsg && (request.method === "PATCH" || request.method === "DELETE")) {
      const userId = await storageUserId(request, env);
      if (!userId) return needLoginJson(request, 401, "unauthorized");
      const store = threadStoreFor(deps, env);
      if (!store) {
        return coreCors(request, Response.json({ error: "thread store not configured" }, { status: 500 }));
      }
      const cardId = decodeURIComponent(mMsg[1] || "");
      const messageId = decodeURIComponent(mMsg[2] || "");
      if (!isValidCardId(cardId)) {
        return coreCors(request, Response.json({ error: "invalid_cardId" }, { status: 400 }));
      }
      if (cardIdMismatch(request.headers.get("x-card-id"), cardId)) {
        return coreCors(request, Response.json({ error: "cardId_mismatch" }, { status: 400 }));
      }
      if (request.method === "DELETE") {
        const r = await deleteMessage(store, userId, cardId, messageId);
        return coreCors(request, Response.json(r.body, { status: r.status }));
      }
      let body: { cardId?: unknown; question?: unknown; answer?: unknown } | null = null;
      try {
        body = (await request.json()) as { cardId?: unknown; question?: unknown; answer?: unknown };
      } catch {
        return coreCors(request, Response.json({ error: "invalid_json" }, { status: 400 }));
      }
      if (body && body.cardId !== undefined && body.cardId !== cardId) {
        return coreCors(request, Response.json({ error: "cardId_mismatch" }, { status: 400 }));
      }
      const r = await patchMessage(store, userId, cardId, messageId, body?.question, body?.answer);
      return coreCors(request, Response.json(r.body, { status: r.status }));
    }
  }
  // S12: 設定export/import。（フロントは匿名にボタンを出さずログイン誘導）。
  // コアはログイン認証を持たないので、アクセストークン一致の Bearer だけが
  // 保存できる。KV 未束縛は 500（面板はローカル設定にフォールバックする）。
  if (request.method === "GET" && url.pathname === "/api/settings") {
    const userId = await storageUserId(request, env);
    if (!userId) return needLoginJson(request, 401, "unauthorized");
    const store = authStoreFor(deps, env);
    if (!store) {
      return coreCors(request, Response.json({ error: "auth store not configured" }, { status: 500 }));
    }
    const record = await getSettings(store, userId);
    if (!record) {
      return coreCors(request, Response.json({ error: "no_settings" }, { status: 404 }));
    }
    return coreCors(request, Response.json(record));
  }
  if (request.method === "POST" && url.pathname === "/api/settings") {
    const userId = await storageUserId(request, env);
    if (!userId) return needLoginJson(request, 401, "unauthorized");
    const store = authStoreFor(deps, env);
    if (!store) {
      return coreCors(request, Response.json({ error: "auth store not configured" }, { status: 500 }));
    }
    let rawText: string;
    try {
      rawText = await request.text();
    } catch {
      return coreCors(request, Response.json({ error: "invalid_settings" }, { status: 400 }));
    }
    let body: unknown;
    try {
      body = rawText ? JSON.parse(rawText) : null;
    } catch {
      return coreCors(request, Response.json({ error: "invalid_settings" }, { status: 400 }));
    }
    const record = await putSettings(store, userId, body);
    if (!record) {
      if (rawText.length > SETTINGS_MAX_BYTES) {
        return coreCors(request, Response.json({ error: "too_large" }, { status: 413 }));
      }
      return coreCors(request, Response.json({ error: "invalid_settings" }, { status: 400 }));
    }
    return coreCors(request, Response.json({ saved: true, updatedAt: record.updatedAt }));
  }

  return coreCors(request, Response.json({ error: "Not Found" }, { status: 404 }));
}

export default {
  async fetch(request: Request, env: CoreEnv): Promise<Response> {
    try {
      return await handleCoreRequest(request, env, {});
    } catch (err) {
      console.error("Unhandled error:", err);
      return coreCors(request, Response.json({ error: "Internal server error" }, { status: 500 }));
    }
  },
};
