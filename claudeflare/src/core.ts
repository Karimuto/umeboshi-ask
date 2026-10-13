// #259 OS3a: billing-free Worker core entry. Second Worker entry beside the
// full build (src/index.ts); source of the Worker part shipped as OSS.
//
// Routes it owns:
//   POST /api/ask/chat                       relay questions (no reserve/settle/budget guard)
//   GET  /api/ask/models                     model list (fixed bundle only)
//   GET  /api/ask/panel                      panel version and stop-flag lookup
//   GET  /api/ask/threads[...]               question/answer storage (Bearer required)
//   GET|POST /api/settings                   settings storage (Bearer required)
//
// Not owned (404 without asking):
//   billing routes (/api/billing/*, /billing, /api/usage)
//   login-auth routes (/api/auth/*, full src/index.ts only)
//   model-inventory cron, allowlist, purge, anon budget
//
// Auth is only the #255 OS2a access token (env ASK_TOKEN). It holds no login
// keys, so only requests whose Bearer matches ASK_TOKEN can save threads and
// settings (userId is the token SHA-256 hash). A non-matching Bearer is 401,
// never anon. Bearer-less chat/models pass through as anon.
//
// #262 OS4a: login auth (external IdP, signed tokens, 20-char codes) stays
// inside the full-only implementation (src/auth.ts), unreachable by import
// from this entry. The contract lives in shared src/identity.ts; only the full
// build injects a token verifier (core passes none, so the path never exists).
//
// Degraded-without-KV contract (defined in OS3a. Answered in src/stores.ts alone):
//   self-host without KV still runs chat/models. Settings fail as before
//   (panel falls back to local settings), thread saves fail and the panel
//   keeps running on its local copy. No anon budget, so no billing story
//   (no charged on chat done).
//
// #264 OS4b: hosted machinery stays out of core (full src/index.ts unchanged).
//   - CORS allow headers are ALLOW_HEADERS_CORE. No billing-webhook signature
//     header (Stripe-Signature): core has no such route
//   - no rate limit (minimal self-use setup. Defers to Cloudflare-side limits).
//     ratelimit/IP hash stay as exports for the full auth scope
//   - model list is the fixed bundle only. allowlist, inventory cache, cron,
//     purge are hosted-side. Drop credits (reserved amount) from responses too
//   - anon budget (double key, JST bucket, credit conversion) is hosted-side.
//     Salt is ANON_SALT only (fallback to the login key is gone: core has no
//     signature check left)
//   - chat route calls no reserve/settle/budget guard (hosted keeps its settle
//     path on its own entry)
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
 * Core CORS reply. Allow headers are ALLOW_HEADERS_CORE (no billing-webhook
 * signature header Stripe-Signature, #264 OS4b). Hosted keeps using the cors.ts
 * default (ALLOW_HEADERS), so hosted behavior never changes.
 *
 * Every entry route passes this one sheet (20+ call sites need lockstep, so
 * bundle them in a function. One direct withCors call restores the header).
 */
function coreCors(request: Request, response: Response): Response {
  return withCors(request, response, ALLOW_HEADERS_CORE);
}

/** Core entry env. Holds no billing/login-auth keys. */
export interface CoreEnv {
  // OpenRouter key. Chat without it answers 503 explicitly.
  OPENROUTER_API_KEY?: string;
  // #255 OS2a: self-host Worker access token (optional, single).
  // Only requests whose Bearer matches it can save threads/settings
  // (userId is the token SHA-256 hash. Raw value never stored).
  // Without it, Bearers are anon and chat/models run as before.
  ASK_TOKEN?: string;
  // Storage KV (optional). Without a binding, threads/settings/panel lookup fail.
  UMEBOSHI_KV?: KVNamespace;
}

/** Core entry deps (test injection). Storage/chat subset of the full Deps. */
export interface CoreDeps {
  store?: AuthStore;
  fetchFn?: typeof fetch;
  /** Test injection (S9 silence-switch deadline override ms). Defaults to SILENCE_TIMEOUT_MS. */
  chatTimeoutMs?: number;
}

/**
 * Core entry HTTP handler. Only owned routes answer; the rest 404.
 *
 * Chat plants no reserve/settle/budget guard as the full build does. It owns
 * no credits concept at all, so pass no onSettled/chargedFor and put no
 * charged on done (panel hides usage display without charged).
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
  // Model list is the fixed bundle only. No allowlist/inventory cache, so pass
  // no store (list stays bundle even with KV bound).
  if (request.method === "GET" && url.pathname === "/api/ask/models") {
    const resolved = await resolveModels(undefined);
    return coreCors(
      request,
      Response.json({
        // #264 OS4b: credits (reserved amount) is billing face value. Core owns
        // no credits concept, so drop it from the list (OS6b boundary-guard premise).
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
  // UM1 (#183/spec #188): panel version/stop-flag lookup. No auth, no body.
  // Self-host without KV has neither, so answer unavailable.
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
  // #259 OS3a: chat with no billing story. Identity only 401s on a wrong token;
  // never calls anon/user budget or settle.
  if (request.method === "POST" && url.pathname === "/api/ask/chat") {
    const identity = await resolveIdentity(request, env);
    if (identity.kind === "unauthorized") {
      return needLoginJson(request, 401, "unauthorized", ALLOW_HEADERS_CORE);
    }
    const resolved = await resolveModels(undefined);
    const chatRes = await handleChat(request, env, deps.fetchFn ?? fetch, {
      models: resolved.models,
      ...(deps.chatTimeoutMs === undefined ? {} : { timeoutMs: deps.chatTimeoutMs }),
    });
    return coreCors(request, chatRes);
  }
  // S6: Thread storage (per-Message, no title, no thinking). Access token only.
  // Anon/wrong token is 401+needLogin, unbound KV is 500.
  // Match: x-card-id header mismatch 400, owner mismatch 403 (threads.ts side).
  if (url.pathname === "/api/ask/threads" && request.method === "GET") {
    const userId = await storageUserId(request, env);
    if (!userId) return needLoginJson(request, 401, "unauthorized", ALLOW_HEADERS_CORE);
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
      if (!userId) return needLoginJson(request, 401, "unauthorized", ALLOW_HEADERS_CORE);
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
      if (!userId) return needLoginJson(request, 401, "unauthorized", ALLOW_HEADERS_CORE);
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
      if (!userId) return needLoginJson(request, 401, "unauthorized", ALLOW_HEADERS_CORE);
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
  // S12: settings export/import. (Front hides the button from anon with a login prompt.)
  // Core has no login auth, so only a Bearer matching the access token can save.
  // Unbound KV is 500 (panel falls back to local settings).
  if (request.method === "GET" && url.pathname === "/api/settings") {
    const userId = await storageUserId(request, env);
    if (!userId) return needLoginJson(request, 401, "unauthorized", ALLOW_HEADERS_CORE);
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
    if (!userId) return needLoginJson(request, 401, "unauthorized", ALLOW_HEADERS_CORE);
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
