// #260 OS3b: threads is a core-entry (src/core.ts) route. Auth is the access token
// (ASK_TOKEN) alone (the JWT path lives on the full-build src/index.ts side). "Owner mismatch
// is 403" needs two JWT identities, so it moved to the full build (test/full/threads-owner.test.ts).
import { describe, expect, it } from "vitest";
import { handleCoreRequest, type CoreEnv } from "../../src/core";
import { memoryStore } from "../../src/stores";

const ASK_TOKEN = "thread-token-0123456789abcdef";

function env(extra: Partial<CoreEnv> = {}): CoreEnv {
  return { ASK_TOKEN, ...extra };
}

function req(path: string, init?: RequestInit): Request {
  return new Request(`https://ask.example${path}`, init);
}

function authed(
  path: string,
  token: string,
  init?: RequestInit,
  extraHeaders: Record<string, string> = {},
): Request {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...extraHeaders,
  };
  return req(path, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string>) } });
}

describe("S6 Thread保存 (Message単位・titleなし・thinkingなし)", () => {
  it("匿名は401＋needLogin (保存押下でログイン案内)", async () => {
    const store = memoryStore();
    const e = env();
    const post = await handleCoreRequest(
      req("/api/ask/threads/c1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: "c1", question: "q", answer: "a" }),
      }),
      e,
      { store },
    );
    expect(post.status).toBe(401);
    expect(await post.json()).toMatchObject({ needLogin: true });

    const get = await handleCoreRequest(req("/api/ask/threads/c1"), e, { store });
    expect(get.status).toBe(401);
    expect(await get.json()).toMatchObject({ needLogin: true });
  });

  it("保存ボタンで1件保存され再表示される (thinkingは保存しない)", async () => {
    const store = memoryStore();
    const e = env();
    const token = ASK_TOKEN;
    const post = await handleCoreRequest(
      authed("/api/ask/threads/cardA/messages", token, {
        method: "POST",
        body: JSON.stringify({
          cardId: "cardA",
          question: "なぜ?",
          answer: "理由はX",
          thinking: "考え中 (保存対象外)",
        }),
      }),
      e,
      { store },
    );
    expect(post.status).toBe(201);
    const created = (await post.json()) as { message: Record<string, unknown> };
    expect(typeof created.message.id).toBe("string");
    expect(created.message.question).toBe("なぜ?");
    expect(created.message.answer).toBe("理由はX");
    expect("thinking" in created.message).toBe(false);
    expect("title" in created.message).toBe(false);

    const get = await handleCoreRequest(authed("/api/ask/threads/cardA", token), e, { store });
    expect(get.status).toBe(200);
    const thread = (await get.json()) as { cardId: string; messages: { id: string }[] };
    expect(thread.cardId).toBe("cardA");
    expect(thread.messages.length).toBe(1);
    expect(thread.messages[0]!.id).toBe(created.message.id);
  });

  it("編集・削除が保存表示に反映される (削除は物理・復元なし)", async () => {
    const store = memoryStore();
    const e = env();
    const token = ASK_TOKEN;
    const post = await handleCoreRequest(
      authed("/api/ask/threads/cardB/messages", token, {
        method: "POST",
        body: JSON.stringify({ cardId: "cardB", question: "q", answer: "a1" }),
      }),
      e,
      { store },
    );
    const id = ((await post.json()) as { message: { id: string } }).message.id;

    const patch = await handleCoreRequest(
      authed(`/api/ask/threads/cardB/messages/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ answer: "a2 直した" }),
      }),
      e,
      { store },
    );
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as { message: { answer: string } }).message.answer).toBe("a2 直した");

    const get1 = await handleCoreRequest(authed("/api/ask/threads/cardB", token), e, { store });
    expect((((await get1.json()) as { messages: { answer: string }[] }).messages[0] as { answer: string }).answer).toBe(
      "a2 直した",
    );

    const del = await handleCoreRequest(
      authed(`/api/ask/threads/cardB/messages/${id}`, token, { method: "DELETE" }),
      e,
      { store },
    );
    expect(del.status).toBe(200);

    const get2 = await handleCoreRequest(authed("/api/ask/threads/cardB", token), e, { store });
    expect(((await get2.json()) as { messages: unknown[] }).messages.length).toBe(0);

    const del2 = await handleCoreRequest(
      authed(`/api/ask/threads/cardB/messages/${id}`, token, { method: "DELETE" }),
      e,
      { store },
    );
    expect(del2.status).toBe(404);
  });

  it("x-card-idヘッダ不一致・body不一致は400", async () => {
    const store = memoryStore();
    const e = env();
    const token = ASK_TOKEN;
    const h = await handleCoreRequest(
      authed(
        "/api/ask/threads/cardC/messages",
        token,
        { method: "POST", body: JSON.stringify({ cardId: "cardC", question: "q", answer: "a" }) },
        { "x-card-id": "other" },
      ),
      e,
      { store },
    );
    expect(h.status).toBe(400);

    const b = await handleCoreRequest(
      authed("/api/ask/threads/cardC/messages", token, {
        method: "POST",
        body: JSON.stringify({ cardId: "cardX", question: "q", answer: "a" }),
      }),
      e,
      { store },
    );
    expect(b.status).toBe(400);
  });

  it("未置換CardID・空は400", async () => {
    const store = memoryStore();
    const e = env();
    const token = ASK_TOKEN;
    const bad = await handleCoreRequest(
      authed("/api/ask/threads/%7B%7BCardID%7D%7D/messages", token, {
        method: "POST",
        body: JSON.stringify({ cardId: "{{CardID}}", question: "q", answer: "a" }),
      }),
      e,
      { store },
    );
    expect(bad.status).toBe(400);
    const blank = await handleCoreRequest(authed("/api/ask/threads/%20", token), e, { store });
    expect(blank.status).toBe(400);
    const direct = await handleCoreRequest(
      authed("/api/ask/threads/%7B%7BCardID%7D%7D", token),
      e,
      { store },
    );
    expect(direct.status).toBe(400);
  });

  it("上限: 1 Message 20000文字超は400", async () => {
    const store = memoryStore();
    const e = env();
    const token = ASK_TOKEN;
    const big = "x".repeat(20001);
    const r = await handleCoreRequest(
      authed("/api/ask/threads/cardE/messages", token, {
        method: "POST",
        body: JSON.stringify({ cardId: "cardE", question: big, answer: "" }),
      }),
      e,
      { store },
    );
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "message_too_long" });
  });

  it("上限: 1 Thread 100 Message超は400", async () => {
    const store = memoryStore();
    const e = env();
    const token = ASK_TOKEN;
    for (let i = 0; i < 100; i++) {
      const r = await handleCoreRequest(
        authed("/api/ask/threads/cardF/messages", token, {
          method: "POST",
          body: JSON.stringify({ cardId: "cardF", question: `q${i}`, answer: "a" }),
        }),
        e,
        { store },
      );
      expect(r.status).toBe(201);
    }
    const over = await handleCoreRequest(
      authed("/api/ask/threads/cardF/messages", token, {
        method: "POST",
        body: JSON.stringify({ cardId: "cardF", question: "over", answer: "a" }),
      }),
      e,
      { store },
    );
    expect(over.status).toBe(400);
    expect(await over.json()).toMatchObject({ error: "thread_full" });
  });

  it("indexは50件cap・新しい順", async () => {
    const store = memoryStore();
    const e = env();
    const token = ASK_TOKEN;
    for (let i = 0; i < 51; i++) {
      const cardId = `idx${i}`;
      const r = await handleCoreRequest(
        authed(`/api/ask/threads/${cardId}/messages`, token, {
          method: "POST",
          body: JSON.stringify({ cardId, question: "q", answer: "a" }),
        }),
        e,
        { store },
      );
      expect(r.status).toBe(201);
    }
    const idx = await handleCoreRequest(authed("/api/ask/threads", token), e, { store });
    expect(idx.status).toBe(200);
    const body = (await idx.json()) as { threads: { cardId: string }[] };
    expect(body.threads.length).toBe(50);
    expect(body.threads[0]!.cardId).toBe("idx50");
  });

  // #100 hole 1: checking ACAO presence alone is not enough.
  // Allowlisted Origins get it; off-list Origins do not.
  it("Thread系は許可リストのOriginにだけCORSヘッダを付ける", async () => {
    const store = memoryStore();
    const e = env();
    const token = ASK_TOKEN;

    const allowed = await handleCoreRequest(
      authed("/api/ask/threads", token, undefined, { Origin: "null" }),
      e,
      { store },
    );
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("null");

    const denied = await handleCoreRequest(
      authed("/api/ask/threads", token, undefined, { Origin: "https://evil.example" }),
      e,
      { store },
    );
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("store未束縛は500で明示する", async () => {
    const e = env();
    const token = ASK_TOKEN;
    const r = await handleCoreRequest(authed("/api/ask/threads/cardZ", token), e, {});
    expect(r.status).toBe(500);
  });
});
