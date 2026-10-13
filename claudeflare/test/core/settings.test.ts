// #260 OS3b: settings is a core-entry (src/core.ts) route. Auth is the access token
// (ASK_TOKEN) alone. JWT identity (owner separation) and missing-JWT_SECRET degradation
// are covered via the full entry by test/full/settings-jwt.test.ts.
import { describe, expect, it } from "vitest";
import { handleCoreRequest, type CoreDeps, type CoreEnv } from "../../src/core";
import { memoryStore } from "../../src/stores";

const ASK_TOKEN = "settings-token-0123456789abcdef";

function env(extra: Partial<CoreEnv> = {}): CoreEnv {
  return { ASK_TOKEN, ...extra };
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

function authed(method: string, path: string, jwt: string, body?: unknown): Request {
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`https://ask.example${path}`, init);
}

function deps(): CoreDeps {
  return { store: memoryStore() };
}

describe("S12 export→別端末importで同環境が再現する", () => {
  it("POST保存→GETで同一設定＋updatedAtが返る", async () => {
    const d = deps();
    const jwt = ASK_TOKEN;
    const payload = validSettings();
    const post = await handleCoreRequest(authed("POST", "/api/settings", jwt, payload), env(), d);
    expect(post.status).toBe(200);
    const saved = (await post.json()) as { saved?: unknown; updatedAt?: unknown };
    expect(saved.saved).toBe(true);
    expect(typeof saved.updatedAt).toBe("string");

    // Import from another device (same user, same KV — not a separate store reference)
    const get = await handleCoreRequest(authed("GET", "/api/settings", jwt), env(), d);
    expect(get.status).toBe(200);
    const body = (await get.json()) as { settings?: unknown; updatedAt?: unknown };
    expect(body.settings).toEqual(payload);
    expect(body.updatedAt).toBe(saved.updatedAt);
  });

  it("未exportのGETは404 no_settings", async () => {
    const res = await handleCoreRequest(authed("GET", "/api/settings", ASK_TOKEN), env(), deps());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(expect.objectContaining({ error: "no_settings" }));
  });
});

describe("S12 匿名では401＋needLogin（ボタン非表示はフロント）", () => {
  it("トークンなしのGET/POSTは401＋needLogin", async () => {
    const d = deps();
    const get = await handleCoreRequest(new Request("https://ask.example/api/settings"), env(), d);
    expect(get.status).toBe(401);
    expect(await get.json()).toEqual(expect.objectContaining({ needLogin: true }));

    const post = await handleCoreRequest(
      new Request("https://ask.example/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validSettings()),
      }),
      env(),
      d,
    );
    expect(post.status).toBe(401);
    expect(await post.json()).toEqual(expect.objectContaining({ needLogin: true }));
  });

  it("不正トークンは401＋needLogin", async () => {
    const res = await handleCoreRequest(authed("GET", "/api/settings", "broken.token"), env(), deps());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(expect.objectContaining({ needLogin: true }));
  });
});

describe("S12 不正ペイロードの拒否", () => {
  it("型不正・上限違反は400、不正JSONも400", async () => {
    const d = deps();
    const jwt = ASK_TOKEN;
    const badBodies: unknown[] = [
      {},
      { ...validSettings(), sendMode: "warp" },
      { ...validSettings(), lang: "fr" },
      { ...validSettings(), lang: "es" },
      { ...validSettings(), lang: "zh-CN" },
      { ...validSettings(), customs: "not-array" },
      { ...validSettings(), prompts: { why: { label: "", body: "" } } },
      {
        ...validSettings(),
        customs: [{ id: "c1", label: "x", body: "" }],
      },
      {
        ...validSettings(),
        customs: Array.from({ length: 101 }, (_, i) => ({ id: `c${i}`, label: "x", body: "y" })),
      },
      { ...validSettings(), efforts: "not-object" },
      { ...validSettings(), efforts: { "m/a": "ultra" } },
      { ...validSettings(), efforts: { "": "low" } },
    ];
    for (const body of badBodies) {
      const res = await handleCoreRequest(authed("POST", "/api/settings", jwt, body), env(), d);
      expect(res.status).toBe(400);
    }
    const broken = new Request("https://ask.example/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: "{broken",
    });
    expect((await handleCoreRequest(broken, env(), d)).status).toBe(400);
  });

  it("巨大ペイロードは413", async () => {
    const d = deps();
    const jwt = ASK_TOKEN;
    const big = validSettings() as Record<string, unknown>;
    const prompts = big["prompts"] as Record<string, { label: string; body: string }>;
    prompts["why"] = { label: "", body: "x".repeat(200 * 1024 + 1) };
    const res = await handleCoreRequest(authed("POST", "/api/settings", jwt, big), env(), d);
    expect(res.status).toBe(413);
  });

  it("storeなしは500で明示する", async () => {
    const noStore = await handleCoreRequest(
      authed("GET", "/api/settings", ASK_TOKEN),
      env(),
      {},
    );
    expect(noStore.status).toBe(500);
  });
});
