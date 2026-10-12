// #259 OS3a: 課金のない Worker コア入口 (src/core.ts)。
// 契約:
//   (1) OPENROUTER_API_KEY だけで chat・models が動く（ASK_TOKEN は任意）
//   (2) 課金 route・Google 認証 route は存在しない（404）
//   (3) KV を束縛しない自己ホストでは chat・models は動き、threads・settings は
//       500（面板はローカル設定にフォールバックする）
//   (4) アクセストークン一致の Bearer だけ threads・settings を保存できる
//       （userId は token の SHA-256 ハッシュ。生値は KV に現れない）
//   (5) chat は課金の話をしない（done に charged を載せない）
//   (6) ログイン認証（外部IdP・署名付きトークン・20文字コード）の route が
//       1 つも無い。挙動は完全版 (src/index.ts) に置いたまま（#262 OS4a）
// #264 OS4b: hosted 運用の機構をコアから外す（完全版の挙動は変えない）。
//   (7) cors の許可ヘッダーに課金 webhook の署名ヘッダー (Stripe-Signature) が無い
//   (8) モデル一覧は bundle のみ。credits（予約額）字段も落とす
//   (9) chat は rate limit も予約・精算も呼ばない（KV を束縛しても書かない）
//   salt 既定（ANON_SALT のみ）は完全版の test/full/settle.test.ts が pin する。
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

/** 上流の stub。返したストリームをそのまま core が流す。 */
function upstreamStub(): typeof fetch {
  return async () =>
    sseResponse([openRouterChunk({ content: "こたえ" }), "data: [DONE]\n\n"]);
}

/** 上流の stub。usage.cost 付き（精算が差額を確定できる形）。 */
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
    // 課金の話は出ない（done に charged を載せない）。
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

    // 保存系は KV が無いので 500。面板はこの失敗を見てローカル設定にフォールバックする。
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

    // 面板照会は KV が無いと unavailable（面板は同梱版のまま動く）。
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

    // 匿名（Bearer なし）の chat は止めない。
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

// #262 OS4a: ログイン認証（Google OAuth・JWT・20文字コード）は完全版
// (src/index.ts) 専用になった。コア側の実体が消えたことを挙動とソースの
// 両方で pin する（恒久ガードは OS6b の仕事。ここは OS4a の自己完結）。
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
    // 検証する実装がコアに無いので、Bearer は ASK_TOKEN との照合だけ。
    // 署名の効かない JWT 形を送っても unauthorized にならず匿名のまま。
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

// #264 OS4b: hosted 運用の機構をコアから外す。課金 route 不在・credits 不在を
// コアの契約として pin する（完全版 src/index.ts の挙動は変えない）。
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

    // 通常の応答（models）にも同じ許可ヘッダーが付く。
    const models = await handleCoreRequest(new Request("https://ask.example/api/ask/models"), env);
    expect(models.status).toBe(200);

    for (const res of [preflight, models]) {
      const allow = res.headers.get("Access-Control-Allow-Headers") ?? "";
      expect(allow).not.toContain("Stripe-Signature");
      // 面板・カードが使うヘッダーはそのまま通す。
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
      // 予約額 (credits) は課金の額面。コアは credits の概念を持たない。
      expect(model).not.toHaveProperty("credits");
      // 面板が ModelTier の照合に使う欄は残す。
      expect(typeof model["id"]).toBe("string");
      expect(typeof model["priceUsdPer1M"]).toBe("number");
    }
  });

  it("chat は rate limit も予約・精算も書かない（KV を束縛しても）", async () => {
    // 完全版なら匿名週予算（初週30c・1c/問）で 31 問目が 429 になる本数を通す。
    // コアはどの route にも rate limit を掛けない（Cloudflare 側の制限に委ねる）。
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
    // 課金 (credits)・回数制限 (ask:rl:) のキーは1つも書かれない。
    expect(puts.filter((p) => p.key.includes("credits"))).toEqual([]);
    expect(puts.filter((p) => p.key.startsWith("ask:rl:"))).toEqual([]);
  });

});
