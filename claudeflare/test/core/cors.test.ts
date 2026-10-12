// #100 穴1「CORS の Origin 無条件反転」の回帰テスト。
//
// #260 OS3b: CORS はコア入口 (src/core.ts) の契約（許可リストは共有の
// src/cors.ts。コアは課金 webhook が無いので許可ヘッダーから Stripe-Signature
// だけが落ちる）。同じ isOriginAllowed を完全版も使うが、entry ごとの配線
// （ALLOW_HEADERS_CORE vs ALLOW_HEADERS）は各自のスイートで pin する。
//
// ここに書くのは「その穴が閉じていないと落ちる」テストだけ。
// 穴を塞ぐ前の挙動をそのまま固定していたテストは
// models.test.ts / threads.test.ts 側で新しい期待値に置き換えた。
//
// 元は security.test.ts の 穴1 だった。分割時に「同一origin」の用例を
// 完全版の /billing からコアの /api/ask/models に差し替えた（コアに
// /billing route は無い。判定は isOriginAllowed の共有ロジック）。
import { describe, expect, it } from "vitest";
import { handleCoreRequest, type CoreEnv } from "../../src/core";

const env: CoreEnv = {};

describe("#100 穴1 CORS は許可リスト以外を反射しない", () => {
  it("別オリジンのGETはACAO無し・レスポンス自体は返す", async () => {
    // 防御は「ブラウザに読ませない」こと。403にすると
    // 未知のOriginを返すWebViewでログインが壊れうるので、
    // 応答は返すがACAOだけを落とす。
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

  // #209: AnkiWeb本体のOrigin。保険として残す。
  it("#209 AnkiWeb のOriginは通す", async () => {
    const res = await handleCoreRequest(
      new Request("https://ask.example/api/ask/models", {
        headers: { Origin: "https://ankiweb.net" },
      }),
      env,
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://ankiweb.net");
  });

  // #209 grill: カードJSは隔離ドメイン ankiuser.net から走る。
  // 実測: console 苦情文 `from origin 'https://ankiuser.net'`。
  // ここを切ると AnkiWeb 上のカードの全fetchが読めなくなる。
  it("#209 grill AnkiWeb のカード隔離ドメインは通す", async () => {
    const res = await handleCoreRequest(
      new Request("https://ask.example/api/ask/models", {
        headers: { Origin: "https://ankiuser.net" },
      }),
      env,
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://ankiuser.net");
  });

  // AnkiDroid/AnkiMobile は reviewer をローカルHTTPサーバで配信する。
  // ここを切るとカードの全fetchが読めなくなる（#100 で実際に踏んだ）。
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
