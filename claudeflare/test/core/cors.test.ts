// #100 hole 1: regression test for "CORS unconditional Origin reflection".
//
// #260 OS3b: CORS is core-entry (src/core.ts) contract (allowlist shared from
// src/cors.ts. Core has no billing webhook, so only Stripe-Signature drops
// from the allowed headers). Both entries share isOriginAllowed, but each
// entry's wiring (ALLOW_HEADERS_CORE vs ALLOW_HEADERS) is pinned by its own suite.
//
// Only tests that fail while the hole is open belong here.
// Tests that pinned pre-fix behavior as-is were replaced with new
// expectations on the models.test.ts / threads.test.ts side.
//
// Split from security.test.ts hole 1. The "same-origin" case was swapped
// from the full build's /billing to core's /api/ask/models (core has
// no /billing route. The check is the shared isOriginAllowed logic).
import { describe, expect, it } from "vitest";
import { handleCoreRequest, type CoreEnv } from "../../src/core";

const env: CoreEnv = {};

describe("#100 穴1 CORS は許可リスト以外を反射しない", () => {
  it("別オリジンのGETはACAO無し・レスポンス自体は返す", async () => {
    // Defense means "don't let the browser read it". Returning 403 could
    // break login in WebViews that send an unknown Origin, so return
    // the response but drop only ACAO.
    const res = await handleCoreRequest(
      new Request("https://ask.example/api/ask/models", {
        headers: { Origin: "https://evil.example" },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("Ankiのfile:// WebView (Origin: null) は引き続き通る", async () => {
    const res = await handleCoreRequest(
      new Request("https://ask.example/api/ask/models", { headers: { Origin: "null" } }),
      env,
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("null");
  });

  it("OPTIONS preflightもリスト外にはACAOを返さない", async () => {
    const evil = await handleCoreRequest(
      new Request("https://ask.example/api/ask/chat", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" },
      }),
      env,
    );
    expect(evil.status).toBe(204);
    expect(evil.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const anki = await handleCoreRequest(
      new Request("https://ask.example/api/ask/chat", {
        method: "OPTIONS",
        headers: { Origin: "null" },
      }),
      env,
    );
    expect(anki.headers.get("Access-Control-Allow-Origin")).toBe("null");
  });

  it("同一origin (Worker自身のオリジン) は通す", async () => {
    const res = await handleCoreRequest(
      new Request("https://ask.example/api/ask/models", {
        headers: { Origin: "https://ask.example" },
      }),
      env,
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://ask.example");
  });

  // #209: the AnkiWeb origin. Kept as insurance.
  it("#209 AnkiWeb のOriginは通す", async () => {
    const res = await handleCoreRequest(
      new Request("https://ask.example/api/ask/models", {
        headers: { Origin: "https://ankiweb.net" },
      }),
      env,
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://ankiweb.net");
  });

  // #209 grill: card JS runs from the isolated ankiuser.net domain.
  // Observed: console complaint `from origin 'https://ankiuser.net'`.
  // Cutting this makes every fetch from cards on AnkiWeb unreadable.
  it("#209 grill AnkiWeb のカード隔離ドメインは通す", async () => {
    const res = await handleCoreRequest(
      new Request("https://ask.example/api/ask/models", {
        headers: { Origin: "https://ankiuser.net" },
      }),
      env,
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://ankiuser.net");
  });

  // AnkiDroid/AnkiMobile serve the reviewer from a local HTTP server.
  // Cutting this makes every fetch from cards unreadable (hit this in #100).
  it("AnkiDroid/AnkiMobile のループバックOriginは通す", async () => {
    for (const origin of [
      "http://127.0.0.1:42665",
      "http://127.0.0.1:37995",
      "http://localhost:8080",
    ]) {
      const res = await handleCoreRequest(
        new Request("https://ask.example/api/ask/models", { headers: { Origin: origin } }),
        env,
      );
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    }
  });

  it("ループバックに似た外部ホストは通さない", async () => {
    for (const origin of [
      "http://127.0.0.1.evil.example",
      "https://localhost.evil.example",
      "http://notlocalhost",
    ]) {
      const res = await handleCoreRequest(
        new Request("https://ask.example/api/ask/models", { headers: { Origin: origin } }),
        env,
      );
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });
});
