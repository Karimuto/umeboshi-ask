// #259 OS3a: billing-free Worker core entry (src/core.ts).
// Contract:
//   (1) chat/models run on OPENROUTER_API_KEY alone (ASK_TOKEN optional)
//   (2) no billing routes or Google auth routes (404)
//   (3) self-hosted without KV bindings: chat/models work, threads/settings return
//       500 (panel falls back to local settings)
//   (4) only a matching-Bearer access token can save threads/settings
//       (userId is the token's SHA-256 hash. Raw value never appears in KV)
//   (5) chat never mentions billing (no charged on done)
//   (6) not a single login-auth (external IdP, signed token, 20-char code) route
//       exists. Behavior stays in the full build (src/index.ts) (#262 OS4a)
// #264 OS4b: strip hosted-ops machinery from core (full build behavior unchanged).
//   (7) CORS allowed headers lack the billing-webhook signature header (Stripe-Signature)
//   (8) model list is bundle-only. Drop the credits (reserved amount) field too
//   (9) chat calls neither rate limit nor reserve/settle (writes nothing even with KV bound)
//   The salt default (ANON_SALT only) is pinned by the full build's test/full/settle.test.ts.
import { describe, expect, it, vi, afterEach } from "vitest";
import { handleCoreRequest, type CoreDeps, type CoreEnv } from "../../src/core";
import { memoryStore, type AuthStore } from "../../src/stores";
import { BUNDLE_MODELS } from "../../src/models";

const ASK_TOKEN = "self-host-token-0123456789abcdef";
const MODEL_ID = BUNDLE_MODELS[0]!.id;

function chatReq(body: unknown, bearer?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearer !== undefined) headers["Authorization"] = `Bearer ${bearer}`;
  return new Request("https://ask.example/api/ask/chat", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function bearerReq(path: string, token: string, init?: RequestInit): Request {
  return new Request(`https://ask.example${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers as Record<string, string>),
    },
  });
}

function sseResponse(chunks: string[]): Response {
  return new Response(chunks.join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function openRouterChunk(delta: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
}

/** Upstream stub. Core passes the returned stream through as-is. */
function upstreamStub(): typeof fetch {
  return async () =>
    sseResponse([openRouterChunk({ content: "こたえ" }), "data: [DONE]\n\n"]);
}

/** Upstream stub with usage.cost (a shape settle could finalize a delta from). */
function usageUpstream(cost: number): Response {
  return new Response(
    `${openRouterChunk({ content: "こたえ" })}` +
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { cost } })}\n\n` +
      "data: [DONE]\n\n",
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

function parseSseEvents(sse: string): { type: string; [k: string]: unknown }[] {
  const events: { type: string; [k: string]: unknown }[] = [];
  for (const line of sse.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) continue;
    const payload = trimmed.slice("data: ".length);
    if (payload === "[DONE]") continue;
    events.push(JSON.parse(payload) as { type: string });
  }
  return events;
}

function validSettings() {
  const prompts: Record<string, { label: string; body: string }> = {};
  for (const k of ["why", "what", "significance", "origin", "eli5"]) {
    prompts[k] = { label: `${k}-label`, body: `${k}-body-本文` };
  }
  return {
    version: 1,
    sendMode: "enter",
    lang: "ja",
    prompts,
    customs: [{ id: "c1", label: "カスタム質問1", body: "「{question}」について答えてください。\n{text}" }],
    efforts: { "z-ai/glm-5.3-flash": "low" },
  };
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("#259 コア入口は OPENROUTER_API_KEY だけで立つ", () => {
  it("ASK_TOKEN・KV がなくても chat がストリームを返す", async () => {
    const env: CoreEnv = { OPENROUTER_API_KEY: "test-key" };

    const chat = await handleCoreRequest(chatReq({ model: MODEL_ID, question: "Q" }), env, {
      fetchFn: upstreamStub(),
    });
    expect(chat.status).toBe(200);
    const sse = await chat.text();
    expect(sse).toContain("こたえ");
    // No billing talk (no charged on done).
    const done = parseSseEvents(sse).find((e) => e.type === "done");
    expect(done).toBeDefined();
    expect(done).not.toHaveProperty("charged");
  });

  it("モデル一覧は bundle 固定だけ", async () => {
    const env: CoreEnv = { OPENROUTER_API_KEY: "test-key" };
    const res = await handleCoreRequest(
      new Request("https://ask.example/api/ask/models"),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: { id: string }[]; source: string };
    expect(body.source).toBe("bundle");
    expect(body.models.map((m) => m.id).sort()).toEqual(BUNDLE_MODELS.map((m) => m.id).sort());
  });

  it("OPENROUTER_API_KEY が無い chat は 503", async () => {
    const env: CoreEnv = {};
    const chat = await handleCoreRequest(chatReq({ question: "Q" }), env, {
      fetchFn: upstreamStub(),
    });
    expect(chat.status).toBe(503);
  });
});

describe("#259 課金 route・Google 認証 route は存在しない", () => {
  it("billing・auth・usage・purge は 404", async () => {
    const env: CoreEnv = { ASK_TOKEN, OPENROUTER_API_KEY: "test-key" };
    const routes: Request[] = [
      new Request("https://ask.example/api/billing/plans"),
      new Request("https://ask.example/api/billing/link", {
        headers: { Authorization: `Bearer ${ASK_TOKEN}` },
      }),
      new Request("https://ask.example/api/billing/purchase", { method: "POST" }),
      new Request("https://ask.example/api/billing/stripe-webhook", { method: "POST" }),
      new Request("https://ask.example/billing"),
      new Request("https://ask.example/api/usage"),
      new Request("https://ask.example/api/auth/login"),
      new Request("https://ask.example/api/auth/callback?code=x&state=y"),
      new Request("https://ask.example/api/auth/redeem", { method: "POST" }),
      new Request("https://ask.example/api/auth/refresh", { method: "POST" }),
      new Request("https://ask.example/api/auth/me", {
        headers: { Authorization: `Bearer ${ASK_TOKEN}` },
      }),
      new Request("https://ask.example/api/admin/models/purge", { method: "POST" }),
    ];
    for (const req of routes) {
      const res = await handleCoreRequest(req, env);
      expect(res.status, `${req.method} ${new URL(req.url).pathname}`).toBe(404);
    }
  });
});

describe("#259 KV を束縛しない自己ホストの劣化", () => {
  it("chat・models は動き、threads・settings は 500（面板はローカルにフォールバック）", async () => {
    const env: CoreEnv = { ASK_TOKEN, OPENROUTER_API_KEY: "test-key" };
    const deps: CoreDeps = { fetchFn: upstreamStub() };

    const chat = await handleCoreRequest(chatReq({ model: MODEL_ID, question: "Q" }, ASK_TOKEN), env, deps);
    expect(chat.status).toBe(200);
    expect(await chat.text()).toContain("こたえ");

    const models = await handleCoreRequest(
      new Request("https://ask.example/api/ask/models"),
      env,
      deps,
    );
    expect(models.status).toBe(200);

    // Savers 500 without KV. The panel sees this failure and falls back to local settings.
    const post = await handleCoreRequest(
      bearerReq(
        "/api/ask/threads/c1/messages",
        ASK_TOKEN,
        {
          method: "POST",
          body: JSON.stringify({ cardId: "c1", question: "q", answer: "a" }),
        },
      ),
      env,
      deps,
    );
    expect(post.status).toBe(500);
    expect(await post.json()).toEqual({ error: "thread store not configured" });

    const settingsGet = await handleCoreRequest(bearerReq("/api/settings", ASK_TOKEN), env, deps);
    expect(settingsGet.status).toBe(500);
    expect(await settingsGet.json()).toEqual({ error: "auth store not configured" });

    const settingsPut = await handleCoreRequest(
      bearerReq("/api/settings", ASK_TOKEN, { method: "POST", body: JSON.stringify(validSettings()) }),
      env,
      deps,
    );
    expect(settingsPut.status).toBe(500);

    // Panel lookup without KV is unavailable (panel keeps running the bundled build).
    const panel = await handleCoreRequest(
      new Request("https://ask.example/api/ask/panel"),
      env,
      deps,
    );
    expect(panel.status).toBe(200);
    expect(await panel.json()).toEqual({ unavailable: true });
  });
});

describe("#259 アクセストークンで threads・settings を保存できる", () => {
  it("正 token で threads の post/get/patch/delete が通る", async () => {
    const store = memoryStore();
    const env: CoreEnv = { ASK_TOKEN, OPENROUTER_API_KEY: "test-key" };
    const deps: CoreDeps = { store };

    const post = await handleCoreRequest(
      bearerReq(
        "/api/ask/threads/cardC/messages",
        ASK_TOKEN,
        {
          method: "POST",
          headers: { "x-card-id": "cardC" },
          body: JSON.stringify({ cardId: "cardC", question: "q", answer: "a1" }),
        },
      ),
      env,
      deps,
    );
    expect(post.status).toBe(201);
    const created = (await post.json()) as { message: { id: string } };
    const id = created.message.id;

    const get = await handleCoreRequest(
      bearerReq("/api/ask/threads/cardC", ASK_TOKEN, { headers: { "x-card-id": "cardC" } }),
      env,
      deps,
    );
    expect(get.status).toBe(200);

    const patch = await handleCoreRequest(
      bearerReq(
        `/api/ask/threads/cardC/messages/${id}`,
        ASK_TOKEN,
        { method: "PATCH", headers: { "x-card-id": "cardC" }, body: JSON.stringify({ answer: "a2" }) },
      ),
      env,
      deps,
    );
    expect(patch.status).toBe(200);

    const del = await handleCoreRequest(
      bearerReq(`/api/ask/threads/cardC/messages/${id}`, ASK_TOKEN, {
        method: "DELETE",
        headers: { "x-card-id": "cardC" },
      }),
      env,
      deps,
    );
    expect(del.status).toBe(200);
  });

  it("正 token で settings の put/get が通る", async () => {
    const store = memoryStore();
    const env: CoreEnv = { ASK_TOKEN, OPENROUTER_API_KEY: "test-key" };
    const deps: CoreDeps = { store };

    const put = await handleCoreRequest(
      bearerReq("/api/settings", ASK_TOKEN, { method: "POST", body: JSON.stringify(validSettings()) }),
      env,
      deps,
    );
    expect(put.status).toBe(200);

    const get = await handleCoreRequest(bearerReq("/api/settings", ASK_TOKEN), env, deps);
    expect(get.status).toBe(200);
    const saved = (await get.json()) as { settings: { lang: string } };
    expect(saved.settings.lang).toBe("ja");
  });

  it("userId は token の SHA-256 ハッシュで、生値は KV に現れない", async () => {
    const store = memoryStore();
    const puts: { key: string; value: string }[] = [];
    const recording: AuthStore = {
      get: (k) => store.get(k),
      put: async (k, v, ttl) => {
        puts.push({ key: k, value: v });
        await store.put(k, v, ttl);
      },
      del: (k) => store.del(k),
    };
    const env: CoreEnv = { ASK_TOKEN, OPENROUTER_API_KEY: "test-key" };
    const deps: CoreDeps = { store: recording };

    await handleCoreRequest(
      bearerReq(
        "/api/ask/threads/cardH/messages",
        ASK_TOKEN,
        {
          method: "POST",
          body: JSON.stringify({ cardId: "cardH", question: "q", answer: "a" }),
        },
      ),
      env,
      deps,
    );

    const expected = await sha256Hex(ASK_TOKEN);
    const raw = await store.get("ask:thread:cardH");
    expect(raw).not.toBeNull();
    const thread = JSON.parse(raw as string) as { ownerId: string };
    expect(thread.ownerId).toBe(expected);
    expect(puts.some((p) => p.key === `ask:thread:index:${expected}`)).toBe(true);
    for (const p of puts) {
      expect(p.key).not.toContain(ASK_TOKEN);
      expect(p.value).not.toContain(ASK_TOKEN);
    }
  });

  it("誤 token・匿名の保存は 401（匿名の chat は通る）", async () => {
    const store = memoryStore();
    const env: CoreEnv = { ASK_TOKEN, OPENROUTER_API_KEY: "test-key" };
    const deps: CoreDeps = { store, fetchFn: upstreamStub() };

    for (const res of [
      await handleCoreRequest(
        bearerReq(
          "/api/ask/threads/c1/messages",
          "wrong-token",
          {
            method: "POST",
            body: JSON.stringify({ cardId: "c1", question: "q", answer: "a" }),
          },
        ),
        env,
        deps,
      ),
      await handleCoreRequest(bearerReq("/api/ask/threads", "wrong-token"), env, deps),
      await handleCoreRequest(bearerReq("/api/settings", "wrong-token"), env, deps),
      await handleCoreRequest(new Request("https://ask.example/api/ask/threads"), env, deps),
    ]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ needLogin: true });
    }

    const chat = await handleCoreRequest(chatReq({ model: MODEL_ID, question: "Q" }, "wrong-token"), env, deps);
    expect(chat.status).toBe(401);

    // Anonymous (no Bearer) chat is not blocked.
    const anon = await handleCoreRequest(chatReq({ model: MODEL_ID, question: "Q" }), env, deps);
    expect(anon.status).toBe(200);
  });
});

describe("#259 面板照会", () => {
  it("KV に版が書かれていれば version・stopped を返す（本文は返さない）", async () => {
    const store = memoryStore();
    await store.put("ask:panel:release:v1", JSON.stringify({ version: "1.3.15" }));
    await store.put("ask:panel:stop:v1", "1");
    const env: CoreEnv = { ASK_TOKEN, OPENROUTER_API_KEY: "test-key" };
    const res = await handleCoreRequest(
      new Request("https://ask.example/api/ask/panel"),
      env,
      { store },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.version).toBe("1.3.15");
    expect(body.stopped).toBe(true);
    expect(body).not.toHaveProperty("panel");
    expect(body).not.toHaveProperty("html");
  });

  it("OPTIONS の preflight は 204", async () => {
    const res = await handleCoreRequest(
      new Request("https://ask.example/api/ask/chat", {
        method: "OPTIONS",
        headers: { Origin: "null", "Access-Control-Request-Method": "POST" },
      }),
      {},
    );
    expect(res.status).toBe(204);
  });
});

// #262 OS4a: login auth (Google OAuth, JWT, 20-char codes) is now full-build
// (src/index.ts) only. Pin the removal from core in both behavior and source
// (the permanent guard is OS6b's job; this is OS4a's self-contained pin).
describe("#262 コア入口に Google 認証 route が 1 つも無い", () => {
  it("login・callback・redeem・refresh・me は GET/POST とも 404", async () => {
    const env: CoreEnv = { ASK_TOKEN, OPENROUTER_API_KEY: "test-key" };
    const paths = [
      "/api/auth/login",
      "/api/auth/callback",
      "/api/auth/redeem",
      "/api/auth/refresh",
      "/api/auth/me",
    ];
    for (const path of paths) {
      for (const method of ["GET", "POST"]) {
        const res = await handleCoreRequest(
          new Request(`https://ask.example${path}`, {
            method,
            ...(method === "POST"
              ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }
              : {}),
          }),
          env,
        );
        expect(res.status, `${method} ${path}`).toBe(404);
      }
    }
  });

  it("JWT 形の Bearer は検証されない（匿名として通る）", async () => {
    // Core has no verifying implementation, so Bearer is only compared against ASK_TOKEN.
    // A JWT-shaped token with a dud signature stays anonymous instead of unauthorized.
    const env: CoreEnv = { OPENROUTER_API_KEY: "test-key" };
    const deps: CoreDeps = { fetchFn: upstreamStub() };
    const fakeJwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.not-a-signature";

    const chat = await handleCoreRequest(chatReq({ model: MODEL_ID, question: "Q" }, fakeJwt), env, deps);
    expect(chat.status).toBe(200);

    const post = await handleCoreRequest(
      bearerReq("/api/ask/threads/cJ/messages", fakeJwt, {
        method: "POST",
        body: JSON.stringify({ cardId: "cJ", question: "q", answer: "a" }),
      }),
      env,
      deps,
    );
    expect(post.status).toBe(401);
  });
});

// #264 OS4b: strip hosted-ops machinery from core. Pin missing billing routes/credits
// as core contract (full build src/index.ts behavior unchanged).
describe("#264 OS4b: hosted 機構はコアに無い", () => {

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cors の許可ヘッダーに課金 webhook の署名ヘッダーが無い", async () => {
    const env: CoreEnv = { ASK_TOKEN, OPENROUTER_API_KEY: "test-key" };

    const preflight = await handleCoreRequest(
      new Request("https://ask.example/api/ask/chat", {
        method: "OPTIONS",
        headers: { Origin: "null", "Access-Control-Request-Method": "POST" },
      }),
      env,
    );
    expect(preflight.status).toBe(204);

    // Normal responses (models) carry the same allowed headers.
    const models = await handleCoreRequest(new Request("https://ask.example/api/ask/models"), env);
    expect(models.status).toBe(200);

    for (const res of [preflight, models]) {
      const allow = res.headers.get("Access-Control-Allow-Headers") ?? "";
      expect(allow).not.toContain("Stripe-Signature");
      // Headers the panel/cards use still pass through.
      for (const header of ["Content-Type", "Authorization", "x-card-id", "X-Anon-Id"]) {
        expect(allow).toContain(header);
      }
    }
  });
  it("未認証 401 の許可ヘッダーにも署名ヘッダーが無い", async () => {
    const env: CoreEnv = { OPENROUTER_API_KEY: "test-key" };
    const unauth = [
      await handleCoreRequest(new Request("https://ask.example/api/ask/threads"), env),
      await handleCoreRequest(new Request("https://ask.example/api/settings"), env),
    ];
    for (const res of unauth) {
      expect(res.status).toBe(401);
      const allow = res.headers.get("Access-Control-Allow-Headers") ?? "";
      expect(allow).not.toContain("Stripe-Signature");
      for (const header of ["Content-Type", "Authorization", "x-card-id", "X-Anon-Id"]) {
        expect(allow).toContain(header);
      }
    }
  });


  it("モデル一覧は bundle のみで credits 字段も落ちる", async () => {
    const env: CoreEnv = { OPENROUTER_API_KEY: "test-key" };
    const res = await handleCoreRequest(new Request("https://ask.example/api/ask/models"), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: Record<string, unknown>[]; source: string };
    expect(body.source).toBe("bundle");
    expect(body.models).toHaveLength(BUNDLE_MODELS.length);
    for (const model of body.models) {
      // credits (reserved amount) is billing face value. Core has no credits concept.
      expect(model).not.toHaveProperty("credits");
      // Columns the panel uses for ModelTier matching stay.
      expect(typeof model["id"]).toBe("string");
      expect(typeof model["priceUsdPer1M"]).toBe("number");
    }
  });

  it("chat は rate limit も予約・精算も書かない（KV を束縛しても）", async () => {
    // Core applies no rate limit on any route (defers to Cloudflare-side limits).
    const store = memoryStore();
    const puts: { key: string; value: string }[] = [];
    const recording: AuthStore = {
      get: (k) => store.get(k),
      put: async (k, v, ttl) => {
        puts.push({ key: k, value: v });
        await store.put(k, v, ttl);
      },
      del: (k) => store.del(k),
    };
    const env: CoreEnv = { OPENROUTER_API_KEY: "test-key" };
    const deps: CoreDeps = { store: recording, fetchFn: upstreamStub() };

    for (let i = 0; i < 40; i++) {
      const res = await handleCoreRequest(chatReq({ model: MODEL_ID, question: "Q" }), env, deps);
      expect(res.status).toBe(200);
      const done = parseSseEvents(await res.text()).find((e) => e.type === "done");
      expect(done).not.toHaveProperty("charged");
    }
    // Neither billing (credits) nor rate-limit (ask:rl:) keys are written at all.
    expect(puts.filter((p) => p.key.includes("credits"))).toEqual([]);
    expect(puts.filter((p) => p.key.startsWith("ask:rl:"))).toEqual([]);
  });

});
