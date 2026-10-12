// #260 OS3b: コア入口 (src/core.ts) を向ける chat テスト。課金・精算に纏わる
// 終端（done/error の charged・cost の確定）は完全版だけの契約なので
// test/full/chat-settle.test.ts が完全版入口 (src/index.ts) を向いて検証する。
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCoreRequest } from "../../src/core";
import { CHAT_SYSTEM_PROMPT, handleChat } from "../../src/chat";
import { BUNDLE_MODELS } from "../../src/models";
import type { ChatEnv } from "../../src/chat";

const env: ChatEnv = { OPENROUTER_API_KEY: "test-key" };

function postChat(body: unknown, init?: RequestInit): Request {
   return new Request("https://ask.example/api/ask/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  });
}

function sseResponse(chunks: string[]): Response {
  const payload = chunks.join("");
  return new Response(payload, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function openRouterChunk(delta: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
}

function openRouterFinish(reason: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}\n\n`;
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/ask/chat (S2最小ループ)", () => {
  it("question欠損・空・8000文字超は400", async () => {
    for (const body of [{}, { question: "" }, { question: "  " }, { question: "x".repeat(8001) }]) {
      const res = await handleCoreRequest(postChat(body), env);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(expect.objectContaining({ error: expect.any(String) }));
    }
  });

  it("不正JSONは400", async () => {
    const req = new Request("https://ask.example/api/ask/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{broken",
    });
    const res = await handleCoreRequest(req, env);
    expect(res.status).toBe(400);
  });

  it("未知modelは404＋fallback、省略時は最安選択可が既定", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([openRouterChunk({ content: "hi" }), "data: [DONE]\n\n"]),
    );
    vi.stubGlobal("fetch", fetchMock);

    // S8契約: Allowlist外は404＋fallback id（フロントが自動切替＋トーストする）
    const bad = await handleCoreRequest(postChat({ model: "nope/unknown", question: "Q" }), env);
    expect(bad.status).toBe(404);
    const badBody = (await bad.json()) as { fallback?: unknown };
    expect(typeof badBody["fallback"] === "string" && badBody["fallback"] !== "").toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    const ok = await handleCoreRequest(postChat({ question: "Q" }), env);
    expect(ok.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).model).toBe(BUNDLE_MODELS[0]!.id);
  });

  it("OpenRouterへmax_tokens 8192・stream:true・messagesで投げる", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([openRouterChunk({ content: "hi" }), "data: [DONE]\n\n"]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const model = BUNDLE_MODELS[1]!.id;
    const res = await handleCoreRequest(postChat({ model, question: "なぜ?" }), env);
    expect(res.status).toBe(200);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent).toMatchObject({
      model,
      max_tokens: 8192,
      stream: true,
      messages: [
        { role: "system", content: CHAT_SYSTEM_PROMPT },
        { role: "user", content: "なぜ?" },
      ],
      reasoning: { effort: "max" },
    });
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-key");
  });

  it("#66: effort指定なしのmimoにはreasoningを送らない", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([openRouterChunk({ content: "hi" }), "data: [DONE]\n\n"]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleCoreRequest(postChat({ model: BUNDLE_MODELS[0]!.id, question: "Q" }), env);
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty("reasoning");
  });

  it("#66: 指定effortをreasoning.effortで送る", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([openRouterChunk({ content: "hi" }), "data: [DONE]\n\n"]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleCoreRequest(
      postChat({ model: BUNDLE_MODELS[3]!.id, question: "Q", effort: "low" }),
      env,
    );
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ reasoning: { effort: "low" } });
  });

  it("#66: 不正な組み合わせは400 invalid_effortで止める", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([openRouterChunk({ content: "hi" }), "data: [DONE]\n\n"]),
    );
    vi.stubGlobal("fetch", fetchMock);
    for (const body of [
      { model: BUNDLE_MODELS[3]!.id, question: "Q", effort: "max" },
      { model: BUNDLE_MODELS[4]!.id, question: "Q", effort: "none" },
      { model: BUNDLE_MODELS[0]!.id, question: "Q", effort: "low" },
      { model: BUNDLE_MODELS[3]!.id, question: "Q", effort: "ultra" },
    ]) {
      const res = await handleCoreRequest(postChat(body), env);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_effort" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reasoning→thinking・content→content・末尾doneの順序を保つ", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          openRouterChunk({ reasoning: "根拠" }),
          openRouterChunk({ content: "答" }),
          openRouterChunk({ content: "え" }),
          "data: [DONE]\n\n",
        ]),
      ),
    );

    const res = await handleCoreRequest(postChat({ question: "なぜ?" }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    const events = parseSseEvents(await res.text());
    expect(events.map((e) => e.type)).toEqual(["thinking", "content", "content", "done"]);
    expect(events[0]).toMatchObject({ type: "thinking", delta: "根拠" });
    expect(events[1]).toMatchObject({ type: "content", delta: "答" });
    expect(events[3]).toMatchObject({ type: "done", messageId: expect.any(String) });
  });

  it("reasoning_content・thinking_contentの別名もthinkingに寄せる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          openRouterChunk({ reasoning_content: "r1" }),
          openRouterChunk({ thinking_content: "r2" }),
          openRouterChunk({ content: "c" }),
          "data: [DONE]\n\n",
        ]),
      ),
    );

    const res = await handleCoreRequest(postChat({ question: "なぜ?" }), env);
    const events = parseSseEvents(await res.text());
    expect(events.map((e) => e.type)).toEqual(["thinking", "thinking", "content", "done"]);
    expect(events[0]?.["delta"]).toBe("r1");
    expect(events[1]?.["delta"]).toBe("r2");
  });

  // #94: 考え中で max_tokens を使い切ると finish_reason=length で本文0文字のまま終わる。
  // done は「正常終了」の意味なので、切り詰めは error として見せる。
  it("#94: finish_reason=lengthはdoneを返さずerror(truncated)を流す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          openRouterChunk({ content: "途中まで" }),
          openRouterFinish("length"),
          "data: [DONE]\n\n",
        ]),
      ),
    );
    const res = await handleCoreRequest(postChat({ question: "なぜ?" }), env);
    expect(res.status).toBe(200);
    const events = parseSseEvents(await res.text());
    expect(events.map((e) => e.type)).toEqual(["content", "error"]);
    expect(events[1]).toMatchObject({ type: "error", code: "truncated", maxTokens: 8192 });
  });

  it("#94: 本文0文字でlength（考え中で予算切れ）でもerrorになる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([openRouterChunk({ reasoning: "r" }), openRouterFinish("length"), "data: [DONE]\n\n"]),
      ),
    );
    const res = await handleCoreRequest(postChat({ question: "なぜ?" }), env);
    const events = parseSseEvents(await res.text());
    expect(events.map((e) => e.type)).toEqual(["thinking", "error"]);
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("#94: finish_reason=stopなら従来どおりdoneで終わる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([openRouterChunk({ content: "c" }), openRouterFinish("stop"), "data: [DONE]\n\n"]),
      ),
    );
    const res = await handleCoreRequest(postChat({ question: "なぜ?" }), env);
    const events = parseSseEvents(await res.text());
    expect(events.map((e) => e.type)).toEqual(["content", "done"]);
  });

  it("#94: finish_reason無しのままdoneは従来どおり", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse([openRouterChunk({ content: "c" }), "data: [DONE]\n\n"])),
    );
    const res = await handleCoreRequest(postChat({ question: "なぜ?" }), env);
    const events = parseSseEvents(await res.text());
    expect(events.map((e) => e.type)).toEqual(["content", "done"]);
  });

  // #94 「lowでも空枠が出る」の実測根拠（claudeflare/CHAT_MAX_TOKENS=8192）：
  // effort=low でも reasoning は 178〜696 token でしか無く finish=stop・本文あり（15/15）。
  // つまり length 経由の切り詰めではない。length 以外で本文0文字は「空で正常終了」であり、
  // カード側は空枠だけが残ってどこも異常表示が出ない。だから error として見せる。
  it("#94: length以外で本文0文字ならdoneでなくerror(empty_answer)を流す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([openRouterChunk({ reasoning: "r" }), openRouterFinish("stop"), "data: [DONE]\n\n"]),
      ),
    );
    const res = await handleCoreRequest(postChat({ question: "なぜ?" }), env);
    const events = parseSseEvents(await res.text());
    expect(events.map((e) => e.type)).toEqual(["thinking", "error"]);
    expect(events[1]).toMatchObject({ type: "error", code: "empty_answer", finishReason: "stop" });
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("#94: 本文0文字・finish_reason無しでもempty_answer（空枠を残さない）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(["data: [DONE]\n\n"])));
    const res = await handleCoreRequest(postChat({ question: "なぜ?" }), env);
    const events = parseSseEvents(await res.text());
    expect(events.map((e) => e.type)).toEqual(["error"]);
    expect(events[0]).toMatchObject({ type: "error", code: "empty_answer", finishReason: null });
  });

  it("#94: finish_reason=error / content_filter でも本文0文字ならempty_answer", async () => {
    for (const reason of ["error", "content_filter"]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          sseResponse([openRouterChunk({ reasoning: "r" }), openRouterFinish(reason), "data: [DONE]\n\n"]),
        ),
      );
      const res = await handleCoreRequest(postChat({ question: "なぜ?" }), env);
      const events = parseSseEvents(await res.text());
      expect(events.map((e) => e.type), reason).toEqual(["thinking", "error"]);
      expect(events[1]).toMatchObject({ type: "error", code: "empty_answer", finishReason: reason });
    }
  });

  // #94: 上流が choices なしの error フレームを流す場合（HTTP200 + 本文0文字）。
  // 解析器は choices を見ずに捨てるため「空で正常終了」になる。カードも何も出さない。
  it("#94: choices無しのerrorフレームも本文0文字ならempty_answerになる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          `data: ${JSON.stringify({ error: { code: 2000, message: "Provider returned error" } })}\n\n`,
          "data: [DONE]\n\n",
        ]),
      ),
    );
    const res = await handleCoreRequest(postChat({ question: "なぜ?" }), env);
    const events = parseSseEvents(await res.text());
    expect(events.map((e) => e.type)).toEqual(["error"]);
    expect(events[0]).toMatchObject({ type: "error", code: "empty_answer" });
  });

  it("#94: 1文字でも本文があればdone（空回答にしない）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([openRouterChunk({ content: "答" }), openRouterFinish("stop"), "data: [DONE]\n\n"]),
      ),
    );
    const res = await handleCoreRequest(postChat({ question: "なぜ?" }), env);
    const events = parseSseEvents(await res.text());
    expect(events.map((e) => e.type)).toEqual(["content", "done"]);
  });

  // #94: 切替（404/S9）先のストリームも本文0文字なら空回答。切替成功でも空は空。
  it("#94: 404で切替した先が本文0文字でもempty_answer（doneにしない）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const model = JSON.parse(init?.body as string).model as string;
        void url;
        if (model === BUNDLE_MODELS[BUNDLE_MODELS.length - 1]!.id) {
          return new Response("no such model", { status: 404 });
        }
        return sseResponse([openRouterChunk({ reasoning: "r" }), openRouterFinish("stop"), "data: [DONE]\n\n"]);
      }),
    );
    const res = await handleCoreRequest(
      postChat({ model: BUNDLE_MODELS[BUNDLE_MODELS.length - 1]!.id, question: "Q" }),
      env,
    );
    expect(res.status).toBe(200);
    const events = parseSseEvents(await res.text());
    expect(events[0]?.type).toBe("switched");
    expect(events.some((e) => e.type === "error" && e["code"] === "empty_answer")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("100問連続投入: 100リクエスト×3 content欠落0・末尾done", async () => {
    const per = ["a;", "b;", "c;"];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([...per.map((d) => openRouterChunk({ content: d })), "data: [DONE]\n\n"]),
      ),
    );

    let total = 0;
    for (let q = 0; q < 100; q++) {
      const res = await handleCoreRequest(postChat({ question: `Q${q}` }), env);
      expect(res.status).toBe(200);
      const events = parseSseEvents(await res.text());
      const parts: string[] = [];
      for (const e of events) {
        if (e.type !== "content") continue;
        const d = e["delta"];
        if (typeof d !== "string") throw new Error("content without string delta");
        parts.push(d);
      }
      expect(parts.join("")).toBe(per.join(""));
      expect(events[events.length - 1]?.type).toBe("done");
      total += parts.length;
    }
    expect(total).toBe(300);
  });

  it("上流が非OKなら502 JSON（ストリーム開始前）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream down", { status: 500 })));
    const res = await handleCoreRequest(postChat({ question: "Q" }), env);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  it("#30: Luna相当の上流400詳細はログ＋レスポンスに原因特定情報が残り秘密は出ない", async () => {
    const seen: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      seen.push(args.map((a) => String(a)).join(" "));
    });
    try {
      const secretQuestion = "Q-secret-question-xyz";
      const leakedKey = env.OPENROUTER_API_KEY ?? "";
      const detail = JSON.stringify({
        error: { message: "max_tokens is not supported for Luna", code: 400, echo: secretQuestion, echoKey: leakedKey },
      });
      vi.stubGlobal("fetch", vi.fn(async () => new Response(detail, { status: 400 })));
      const lunaOnly = [{ ...BUNDLE_MODELS[3]!, selectable: true }];
      const res = await handleChat(postChat({ model: lunaOnly[0]!.id, question: secretQuestion }), env, fetch, {
      });
      expect(res.status).toBe(502);
      const body = (await res.json()) as Record<string, unknown>;
      const logged = seen.join("\n");
      expect(logged).toContain(lunaOnly[0]!.id);
      expect(logged).toContain("400");
      expect(logged).toContain("max_tokens");
      expect(logged).toContain("[redacted]");
      expect(body).toMatchObject({ upstreamStatus: 400, model: lunaOnly[0]!.id });
      expect(String(body["upstreamPreview"])).toContain("max_tokens");
      expect(String(body["upstreamPreview"])).toContain("[redacted]");
      expect(logged).not.toContain("test-key");
      expect(logged).not.toContain(secretQuestion);
      expect(JSON.stringify(body)).not.toContain("test-key");
      expect(JSON.stringify(body)).not.toContain(secretQuestion);
    } finally {
      spy.mockRestore();
    }
  });
  it("S8: 上流404は安い選択可モデルへ自動切替し先頭にswitchedを流す", async () => {
     const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const model = JSON.parse(init?.body as string).model as string;
        calls.push(model);
        if (calls.length === 1) return new Response("no such model", { status: 404 });
        return sseResponse([openRouterChunk({ content: "fb" }), "data: [DONE]\n\n"]);
      }),
    );
    const retired = BUNDLE_MODELS[BUNDLE_MODELS.length - 1]!.id;
    const res = await handleCoreRequest(postChat({ model: retired, question: "Q" }), env);
    expect(res.status).toBe(200);
    expect(calls).toEqual([retired, BUNDLE_MODELS[0]!.id]);
    const events = parseSseEvents(await res.text());
    expect(events[0]).toMatchObject({
      type: "switched",
      from: retired,
      to: BUNDLE_MODELS[0]!.id,
      reason: "model_404",
      charged: true,
    });
    expect(events[events.length - 1]?.type).toBe("done");
  });
  it("#66: 自動切替先には切替先のdefault effortを送りswitchedに載せる", async () => {
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        sent.push(JSON.parse(init?.body as string) as Record<string, unknown>);
        if (sent.length === 1) return new Response("no such model", { status: 404 });
        return sseResponse([openRouterChunk({ content: "fb" }), "data: [DONE]\n\n"]);
      }),
    );
    const retired = BUNDLE_MODELS[BUNDLE_MODELS.length - 1]!.id;
    const res = await handleCoreRequest(
      postChat({ model: retired, question: "Q", effort: "low" }),
      env,
    );
    expect(res.status).toBe(200);
    expect(sent[0]).toMatchObject({ model: retired, reasoning: { effort: "low" } });
    expect(sent[1]).not.toHaveProperty("reasoning");
    const events = parseSseEvents(await res.text());
    expect(events[0]).toMatchObject({ type: "switched", to: BUNDLE_MODELS[0]!.id });
    expect(events[0]).not.toHaveProperty("effort");
  });
  // 例外 (ts-no-test-timers): 沈黙時間と上流到着のwall-clockレース自体が検証対象のため実時間で待つ。
  // fake clockではdeadlineと到着が同じ仮想時計で進みレースを観測できない。
  it("S9: 完全無音が続けば別モデルへ切替しswitched(reason timeout, charged:true)を1回だけ流す", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const model = JSON.parse(init?.body as string).model as string;
        calls.push(model);
        if (calls.length === 1) {
          return new Response(new ReadableStream<Uint8Array>({}), {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        return sseResponse([openRouterChunk({ content: "fb" }), "data: [DONE]\n\n"]);
      }),
    );
    const first = BUNDLE_MODELS[1]!.id;
    const res = await handleCoreRequest(postChat({ model: first, question: "Q" }), env, { chatTimeoutMs: 20 });
    expect(res.status).toBe(200);
    expect(calls).toEqual([first, BUNDLE_MODELS[0]!.id]);
    const events = parseSseEvents(await res.text());
    expect(events.filter((e) => e.type === "switched")).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "switched",
      from: first,
      to: BUNDLE_MODELS[0]!.id,
      reason: "timeout",
      charged: true,
    });
    expect(events.map((e) => e.type)).toEqual(["switched", "content", "done"]);
  });

  // 実時間の60ms遅延チャンクで「thinking到達後にdeadline超過」を再現 (上記例外と同じ理由)。
  it("S9: thinking到達後は15秒超でも待つ（切替なし）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            const enc = new TextEncoder();
            c.enqueue(enc.encode(openRouterChunk({ reasoning: "r" })));
            setTimeout(() => {
              c.enqueue(enc.encode(openRouterChunk({ content: "c" })));
              c.enqueue(enc.encode("data: [DONE]\n\n"));
              c.close();
            }, 60);
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );
    const res = await handleCoreRequest(postChat({ question: "Q" }), env, { chatTimeoutMs: 20 });
    expect(res.status).toBe(200);
    const events = parseSseEvents(await res.text());
    expect(events.map((e) => e.type)).toEqual(["thinking", "content", "done"]);
  });


  it("APIキー欠損は503 JSON", async () => {
    const fetchMock = vi.fn(async () => sseResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleCoreRequest(postChat({ question: "Q" }), {} as never);
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTにもCORSヘッダが付く", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse([openRouterChunk({ content: "x" }), "data: [DONE]\n\n"])),
    );
    const res = await handleCoreRequest(
      postChat({ question: "Q" }, { headers: { "Content-Type": "application/json", Origin: "null" } }),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("null");
  });
});

describe("OpenRouter単線 (ADR 0015)", () => {
  it("OpenRouterへ直接投げ、provider_fallbackは流さない", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([openRouterChunk({ content: "hi" }), "data: [DONE]\n\n"]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleChat(postChat({ model: BUNDLE_MODELS[0]!.id, question: "Q" }), env, fetch);
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent).toMatchObject({ model: BUNDLE_MODELS[0]!.id, stream: true, max_tokens: 8192 });
    expect(sent).not.toHaveProperty("reasoning");
    const events = parseSseEvents(await res.text());
    expect(events.map((e) => e.type)).toEqual(["content", "done"]);
    expect(events.some((e) => e.type === "switched")).toBe(false);
  });

  it("上流5xxは再送せず502 JSON（予備への跨ぎなし）", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        calls.push(String(url));
        return new Response("down", { status: 500 });
      }),
    );
    const res = await handleChat(postChat({ model: BUNDLE_MODELS[0]!.id, question: "Q" }), env, fetch);
    expect(res.status).toBe(502);
    expect(calls).toEqual(["https://openrouter.ai/api/v1/chat/completions"]);
  });

  it("Go鍵があっても無視してOpenRouterに投げる（OPENCODE_GO_API_KEY撤去）", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([openRouterChunk({ content: "hi" }), "data: [DONE]\n\n"]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleChat(postChat({ model: BUNDLE_MODELS[0]!.id, question: "Q" }), {
      OPENROUTER_API_KEY: "test-key",
      OPENCODE_GO_API_KEY: "go-key",
    } as never, fetch);
    expect(res.status).toBe(200);
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
  });
});
