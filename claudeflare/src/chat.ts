// S2: Why?→回答ストリーミング最小ループ。上流はOpenRouter単線（ADR 0015）。
// 上流SSEを StreamEvent (thinking/content/switched/done+error) に寄せる。
// S8: Allowlist外modelは404＋fallback id、上流404は同一上流の安い選択可モデルへ自動切替し
// 先頭にswitched (charged:true＋effort) を流す。S4(匿名credits)は含めない。
// S9: 15秒完全無音 (thinking・contentともになし) でのみ別モデルへ1度だけ自動切替し
// 先頭にswitched (reason:"timeout", charged:true＋effort) を流す。thinking到達後は待つ。
// 切替・中断の消費は実cost通りユーザ負担・表示なし (無音attemptはabortして破棄。精算はcharged:trueを元にHOST/S10側)。
// S3: questionはテンプレ＋カード文脈込みの組成文のため上限8000（素の質問2000＋文脈）。
// - max_tokens 8192一律（#94: effort で変えない。考え中だけで使い切ると本文0になるため、
//   切れたときは done じゃなく error で返す）
// - LLM出力はMarkdown直接（JSON repairなし。素通しのみ）
// - 順序保証 thinking→content→done（上流到着順を保ち、doneを末尾に1回）
// #66: Effortは reasoning.effort で送る。未指定は各モデルのdefault effort（選択なしは送らない）。
// 不正な組み合わせは400 invalid_effortで止める。自動切替先は切替先のdefault effort。
import {
  BUNDLE_MODELS,
  cheapestSelectable,
  defaultEffortFor,
  isValidEffortForModel,
  nextFallbackModel,
  type EffortValue,
  type ResolvedModel,
} from "./models";

export const CHAT_MAX_TOKENS = 8192;
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const CHAT_QUESTION_MAX = 8000;
/** #35: OpenRouterへ毎回先頭に付けるsystem prompt。振る舞いの土台。 */
export const CHAT_SYSTEM_PROMPT = `# Role
You are a professor who is exceptionally clear and easy to understand. Based on the provided Problem Statement, Supplementary Information, and User's Question, create a response that deepens the user's understanding of their question.`;
/** S9: thinking・contentとも来ない完全無音が続いたら別モデルへ切替えるdeadline。 */
export const SILENCE_TIMEOUT_MS = 15_000;
/** #30: 上流エラー診断用に残すbody先頭の最大文字数。 */
export const UPSTREAM_ERROR_PREVIEW_MAX = 500;

export interface ChatEnv {
  OPENROUTER_API_KEY?: string;
}

export function defaultChatModel(): string {
  return BUNDLE_MODELS[0]!.id;
}

export function isAllowedChatModel(id: string, allowed?: readonly { id: string }[]): boolean {
  return (allowed ?? BUNDLE_MODELS).some((m) => m.id === id);
}


function sseLine(obj: unknown, encoder: TextEncoder): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);
}

function textEvent(type: "thinking" | "content", delta: string): { type: string; delta: string }[] {
  return delta !== "" ? [{ type, delta }] : [];
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** 上流1行の解析結果。finish_reason は「上流がそこで止めた理由」。 */
export interface UpstreamChunk {
  /** 流すイベント列。到着順を保つ。 */
  events: { type: string; delta?: string }[];
  /** choices[0].finish_reason。該当なしは null。 */
  finishReason: string | null;
  /** #169: usage.cost（USD）。正の有限数のときだけ値、他は null。tokens 系は持たない。 */
  cost: number | null;
}

/** SSEの生行1行の data payload をparseする。該当なし・壊れ行は null。 */
function ssePayload(rawLine: string): unknown {
  const line = rawLine.trim();
  if (!line.startsWith("data:")) return null;
  const payload = line.slice("data:".length).trim();
  if (payload === "" || payload === "[DONE]") return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null; // 壊れた行は捨てる（欠落ではなく破損行のスキップ）
  }
}

/** 上流1行から (thinking/content イベント, finish_reason) を取る。 */
export function parseSseLine(rawLine: string): UpstreamChunk {
  const body = recordOf(ssePayload(rawLine));
  // #169: 終端の上流 usage フレームは choices の外（直下 usage.cost）に載る。
  // OpenRouter は毎回自動で付ける（stream_options は非推奨のため送らない）。
  // 正の有限数のときだけ採用し、tokens 系は見ない・運ばない。
  const rawCost = recordOf(body?.["usage"])?.["cost"];
  const cost = typeof rawCost === "number" && Number.isFinite(rawCost) && rawCost > 0 ? rawCost : null;
  const choices = body?.["choices"];
  const choice = Array.isArray(choices) ? recordOf(choices[0]) : null;
  if (!choice) return { events: [], finishReason: null, cost };
  // #94: finish_reason はChoices側。delta が無くても finish_reason だけが載る行がある。
  const finishReason = stringField(choice["finish_reason"]);
  const deltaRecord = recordOf(choice["delta"]);
  if (!deltaRecord) return { events: [], finishReason, cost };
  const out: { type: string; delta?: string }[] = [];
  const thinkingRaw =
    deltaRecord["reasoning"] ?? deltaRecord["reasoning_content"] ?? deltaRecord["thinking_content"] ?? deltaRecord["thinking"];
  const thinking = stringField(thinkingRaw);
  if (thinking) out.push(...textEvent("thinking", thinking));
  const content = stringField(deltaRecord["content"]);
  if (content) out.push(...textEvent("content", content));
  return { events: out, finishReason, cost };
}

/** #94: finish_reason=length は max_tokens で切れた印。空で完了させず error にする。 */
export const TRUNCATED_CODE = "truncated";
/** #94: 「空で正常終了」（cut off=length ではないのに本文0文字）のときの code。
 *  実測: effort=low でも本文は出る（15/15 本文あり・reasoning 178〜696/8192）。
 *  よって low で空枠が出る事は max_tokens とは別原因で、切り詰め説では説明できない。 */
export const EMPTY_ANSWER_CODE = "empty_answer";


export interface ChatSettled {
  /** 完了 attempt の生cost。本文0の終端では null だけが来る（全額返金の印）。 */
  cost: number | null;
  /** カードへ流した本文の文字数。0 のまま終われば予約全額返金の印。 */
  contentChars: number;
}

export interface ChatModels {
  /** 解決済み一覧 (安い順)。未指定時はbundle固定5モデル。 */
  models?: ResolvedModel[];
  /** S9無音deadline上書き (ms)。テスト注入用。未指定時はSILENCE_TIMEOUT_MS。 */
  timeoutMs?: number;
  /** #171: 終端確定後の精算口。ストリーム終端後に呼ばれる。 */
  onSettled?: ((settled: ChatSettled) => void) | undefined;
  /** #172: done に載せる確定額の計算口。予約額が起点で、実費が確定すれば実費へ寄せる。 */
  chargedFor?: ((cost: number | null) => number | null) | undefined;
}


interface AttemptLink {
  controller: AbortController;
  dispose: () => void;
}

interface PrefixState {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  buffer: string;
  events: { type: string; delta?: string }[];
  /** #94: 無音待ち中に届いた行の finish_reason。後のストリームに持ち越す。 */
  finishReason: string | null;
  /** #169: 無音待ち中に届いた上流 usage.cost。同一 attempt の継続にだけ持ち越す（切替時は捨てる）。 */
  cost: number | null;
}

export type ChatModelDecision = { id: string } | { unknownModel: true; fallback: string };

/** body.model→確定モデルid。S4の匿名課金前段とhandleChat本体で同一判定にする。 */
export function selectChatModelId(
  rawModel: unknown,
  allowed: readonly ResolvedModel[],
): ChatModelDecision {
  const fallback = cheapestSelectable(allowed)?.id ?? defaultChatModel();
  if (rawModel === undefined || rawModel === null || rawModel === "") return { id: fallback };
  if (typeof rawModel !== "string" || !isAllowedChatModel(rawModel, allowed)) {
    return { unknownModel: true, fallback };
  }
  return { id: rawModel };
}

export type ChatEffortDecision =
  | { effort: EffortValue | null }
  | { invalidEffort: true; model: string; supportedEfforts: readonly EffortValue[] };

/** #66 body.effort→確定effort。未指定は切替先も含め各モデルのdefault effort（送らない選択なしはnull）。 */
export function selectChatEffort(
  rawEffort: unknown,
  model: Pick<ResolvedModel, "id" | "supportedEfforts" | "defaultEffort" | "reasoningMandatory">,
): ChatEffortDecision {
  if (rawEffort === undefined || rawEffort === null || rawEffort === "") {
    return { effort: defaultEffortFor(model) };
  }
  if (!isValidEffortForModel(model, rawEffort)) {
    return { invalidEffort: true, model: model.id, supportedEfforts: model.supportedEfforts ?? [] };
  }
  return { effort: rawEffort };
}

export async function handleChat(
  request: Request,
  env: ChatEnv,
  upstreamFetch: typeof fetch = fetch,
  chatModels: ChatModels = {},
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = (body as { question?: unknown; model?: unknown }).question;
  const question = typeof raw === "string" ? raw.trim() : "";
  if (question === "" || question.length > CHAT_QUESTION_MAX) {
    return Response.json({ error: "Invalid question" }, { status: 400 });
  }

  const allowed = chatModels.models ?? BUNDLE_MODELS.map((m) => ({ ...m, selectable: true }));
  const rawBody = recordOf(body);
  const rawModel = rawBody ? rawBody["model"] : undefined;
  const decided = selectChatModelId(rawModel, allowed);
  if ("unknownModel" in decided) {
    return Response.json({ error: "unknown_model", fallback: decided.fallback }, { status: 404 });
  }
  const model = decided.id;
  const modelMeta = allowed.find((m) => m.id === model) ?? BUNDLE_MODELS.find((m) => m.id === model);
  const decidedEffort = selectChatEffort(rawBody ? rawBody["effort"] : undefined, {
    id: model,
    supportedEfforts: modelMeta?.supportedEfforts ?? [],
    defaultEffort: modelMeta?.defaultEffort ?? null,
    reasoningMandatory: modelMeta?.reasoningMandatory ?? false,
  });
  if ("invalidEffort" in decidedEffort) {
    return Response.json(
      { error: "invalid_effort", model: decidedEffort.model, supportedEfforts: decidedEffort.supportedEfforts },
      { status: 400 },
    );
  }
  const requestedEffort = decidedEffort.effort;
  const openRouterKey = env.OPENROUTER_API_KEY;
  if (!openRouterKey) {
    return Response.json({ error: "LLM not configured", code: "llm_not_configured" }, { status: 503 });
  }
  /** #66 送信effort。自動切替先は切替先のdefault effort（Q9回答）。 */
  function effortFor(targetId: string): EffortValue | null {
    if (targetId === model) return requestedEffort;
    const target = allowed.find((m) => m.id === targetId) ?? BUNDLE_MODELS.find((m) => m.id === targetId);
    if (!target) return null;
    return defaultEffortFor(target);
  }
  function openRouterBody(openRouterModel: string): string {
    const payload: Record<string, unknown> = {
      model: openRouterModel,
      messages: [
        { role: "system", content: CHAT_SYSTEM_PROMPT },
        { role: "user", content: question },
      ],
      max_tokens: CHAT_MAX_TOKENS,
      stream: true,
    };
    const effort = effortFor(openRouterModel);
    if (effort !== null) payload["reasoning"] = { effort };
    return JSON.stringify(payload);
  }

  /** OpenRouter単線の送信先。 */
  async function postUpstream(modelId: string, signal: AbortSignal): Promise<Response> {
    return upstreamFetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        "Content-Type": "application/json",
      },
      body: openRouterBody(modelId),
      signal,
    });
  }

  // attempt用AbortController。クライアントabortを上流へ伝播し、S9無音timeoutでもabortする。
  // 使い終わったらdisposeでlistenerを外す (破棄済みattemptのabortに引っ張られないため)。
  function linkAttempt(): AttemptLink {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    if (request.signal.aborted) {
      controller.abort();
    } else {
      request.signal.addEventListener("abort", onAbort, { once: true });
    }
    return { controller, dispose: () => request.signal.removeEventListener("abort", onAbort) };
  }

  function isAbortError(err: unknown): boolean {
    return (err as Error)?.name === "AbortError";
  }

  function dropLink(link: AttemptLink): void {
    link.dispose();
    try {
      link.controller.abort();
    } catch {
      // 二重abortは無視
    }
  }

  async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    try {
      await reader.cancel();
    } catch {
      // 二重cancelは無視
    }
  }

  // 上流POST。msがnullでなければdeadline付き (S9)。timeout時は上流をabortしてtimeoutを返す。
  async function postAttempt(
    modelId: string,
    ms: number | null,
  ): Promise<
    | { kind: "ok"; res: Response; link: AttemptLink }
    | { kind: "timeout" }
    | { kind: "abort" }
    | { kind: "error"; error: unknown }
  > {
    const link = linkAttempt();
    let timedOut = false;
    const timer =
      ms === null
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            link.controller.abort();
          }, ms);
    try {
      const res = await postUpstream(modelId, link.controller.signal);
      return { kind: "ok", res, link };
    } catch (error) {
      link.dispose();
      if (timedOut) return { kind: "timeout" };
      if (isAbortError(error)) return { kind: "abort" };
      return { kind: "error", error };
    } finally {
      clearTimeout(timer);
    }
  }

  // S9: first-byte相当 (thinking・contentのいずれか) をdeadlineまで待つ。
  // 返却したreader/decoder/bufferはそのまま最終ストリームへ引き継ぐ (再送なし)。
  async function waitFirstEvent(
    upstream: Response,
    deadline: number,
  ): Promise<
    | ({ outcome: "event" | "ended" } & PrefixState)
    | { outcome: "timeout" | "abort"; reader: ReadableStreamDefaultReader<Uint8Array> }
  > {
    const reader = upstream.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const events: { type: string; delta?: string }[] = [];
    let finishReason: string | null = null;
    let firstCost: number | null = null;
    let fireTimeout: () => void = () => {};
    const timer = setTimeout(() => fireTimeout(), Math.max(0, deadline - Date.now()));
    const timeoutP = new Promise<"timeout">((resolve) => {
      fireTimeout = () => resolve("timeout");
    });
    const onAbort = (): void => fireAbort();
    let fireAbort: () => void = onAbort;
    const abortP = new Promise<"abort">((resolve) => {
      fireAbort = () => resolve("abort");
    });
    if (request.signal.aborted) fireAbort();
    else request.signal.addEventListener("abort", onAbort, { once: true });
    // 行は1度だけparseし、finish_reason も同時に拾う（#94）。
    const parseLine = (rawLine: string): void => {
      const chunk = parseSseLine(rawLine);
      if (chunk.finishReason !== null) finishReason = chunk.finishReason;
      if (chunk.cost !== null) firstCost = chunk.cost;
      for (const ev of chunk.events) events.push(ev);
    };
    try {
      for (;;) {
        const winner = await Promise.race([
          reader
            .read()
            .then((r): { kind: "read"; done: boolean; value: Uint8Array | undefined } => ({
              kind: "read",
              done: r.done,
              value: r.done ? undefined : r.value,
            })),
          timeoutP.then((): { kind: "timeout" } => ({ kind: "timeout" })),
          abortP.then((): { kind: "abort" } => ({ kind: "abort" })),
        ]);
        if (winner.kind === "timeout") return { outcome: "timeout", reader };
        if (winner.kind === "abort") return { outcome: "abort", reader };
        if (winner.done || winner.value === undefined)
          return { outcome: "ended", reader, decoder, buffer, events, finishReason, cost: firstCost };
        buffer += decoder.decode(winner.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const rawLine of lines) parseLine(rawLine);
        if (events.length > 0)
          return { outcome: "event", reader, decoder, buffer, events, finishReason, cost: firstCost };
      }
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", onAbort);
    }
  }

  function cancelled(): Response {
    // #174: 中断は本文0なので予約全額返金の印だけ送る。
    try {
      chatModels.onSettled?.({ cost: null, contentChars: 0 });
    } catch {
      // 精算口の失敗で応答自体を壊さない
    }
    return Response.json({ error: "Request cancelled" }, { status: 499 });
  }

  // #30: 上流レスポンスbodyの先頭だけ抜く。cloneを読んで原本のストリームを消費しない。
  // 上流がrequest内容をechoしても秘密が出ないよう、APIキー・Bearer・質問全文をマスクする。
  // 短い一致は診断文を壊すため一定長以上の秘密のみ対象。
  function scrubSecrets(text: string): string {
    const bearer = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const escapedQuestion = JSON.stringify(question).slice(1, -1);
    const secrets: string[] = [openRouterKey ?? "", bearer, question, escapedQuestion];
    let out = text;
    for (const secret of secrets) {
      if (secret !== "" && secret.length >= 8) out = out.split(secret).join("[redacted]");
    }
    return out;
  }

  async function previewOf(res: Response): Promise<string> {
    try {
      return scrubSecrets(await res.clone().text()).slice(0, UPSTREAM_ERROR_PREVIEW_MAX);
    } catch {
      return "";
    }
  }

  function previewOfError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return scrubSecrets(message).slice(0, UPSTREAM_ERROR_PREVIEW_MAX);
  }
  // #30: 上流失敗はモデル＋status＋body先頭をconsole.error（wrangler tailで見える化）し、
  // 502のJSONにも安全な範囲（status＋body先頭＋モデル）で同梱する。APIキー・Bearer・質問は入れない。
  async function upstreamError(modelId: string, status: number | null, preview: string): Promise<Response> {
    const head = preview.slice(0, UPSTREAM_ERROR_PREVIEW_MAX);
    console.error(
      `upstream error model=${modelId} status=${status === null ? "fetch_failed" : status} body=${head}`,
    );
    // #174: 上流が応じる前に終わった。本文0なので予約全額返金の印だけ送る。
    try {
      chatModels.onSettled?.({ cost: null, contentChars: 0 });
    } catch {
      // 精算口の失敗で応答自体を壊さない
    }
    return Response.json(
      { error: "LLM upstream error", model: modelId, upstreamStatus: status, upstreamPreview: head },
      { status: 502 },
    );
  }

  // 切替先つきで上流POST (deadlineなし・単発)。失敗時はabort/errorをそのまま返す。
  async function postFallback(
    fallbackId: string,
  ): Promise<{ kind: "ok"; res: Response; link: AttemptLink } | { kind: "abort" } | { kind: "error"; error: unknown }> {
    const r = await postAttempt(fallbackId, null);
    if (r.kind === "ok") return r;
    if (r.kind === "abort") return r;
    if (r.kind === "timeout") return { kind: "error", error: "timeout" };
    return r;
  }

  // S8切替先 (安い順で最初の選択可)。S9切替先と一致する場合が多いが、現行が最安の場合は異なる。
  const timeoutMs = chatModels.timeoutMs ?? SILENCE_TIMEOUT_MS;
  const s8Fallback = cheapestSelectable(allowed)?.id ?? defaultChatModel();
  // S9切替先 (現行以外の安い選択可)。nullなら単一モデルのみで切替不可→従来通り待つ。
  const silenceFallbackId = nextFallbackModel(allowed, model)?.id ?? null;
  let switched: { from: string; to: string; reason: "model_404" | "timeout"; effort: EffortValue | null } | null = null;
  function markSwitched(from: string, to: string, reason: "model_404" | "timeout"): void {
    switched = { from, to, reason, effort: effortFor(to) };
  }
  let upstream: Response;
  let link: AttemptLink;
  let prefix: PrefixState | null = null;
  let upstreamModel = model;

  function streamWithPrefix(): Response {
    const prefixReader = prefix?.reader;
    const prefixDecoder = prefix?.decoder;
    const prefixEvents = prefix?.events ?? [];
    const prefixBuffer = prefix?.buffer ?? "";
    let finishReason: string | null = prefix?.finishReason ?? null;
    // #169: 完了 attempt の上流 usage.cost（直近の正の有限値）。捨て attempt の分は prefix ごと捨てる。
    let upstreamCost: number | null = prefix?.cost ?? null;
    // #94: カードへ流した本文の文字数。length 以外で本文0文字は「空で正常終了」。
    let contentChars =
      prefixEvents.reduce((n, ev) => (ev.type === "content" ? n + (ev.delta ?? "").length : n), 0);

    // waitFirstEventで消費済みのreaderを引き継ぐ場合があるため、ここでは新規getReaderしない。
    const reader = prefixReader ?? upstream.body!.getReader();
    const decoder = prefixDecoder ?? new TextDecoder();
    const encoder = new TextEncoder();
    const messageId = crypto.randomUUID();
    let buffer = prefixBuffer;
    const activeLink = link;

    const onSettled = chatModels.onSettled;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (obj: unknown): void => {
          controller.enqueue(sseLine(obj, encoder));
        };
        // #172: done に確定額 charged を載せる。予約額が起点で、実費確定で実費へ。
        // error/truncated 終端では呼ばれない。口が無ければ余計なし。
        const chargedDone = (messageId: string, cost: number | null, rawCost: number | null): Record<string, unknown> => {
          const base: Record<string, unknown> = cost === null ? { type: "done", messageId } : { type: "done", messageId, cost: rawCost };
          try {
            const charged = chatModels.chargedFor?.(cost) ?? null;
            if (charged !== null) base["charged"] = charged;
          } catch {
            // 表示口の失敗でストリーム自体を壊さない
          }
          return base;
        };
        // #172: error 終端に実費確定のときだけ charged を載せる。本文0・未確定は載せない。
        const chargedError = (code: string, extra: Record<string, unknown>): Record<string, unknown> => {
          const base: Record<string, unknown> = { type: "error", code, ...extra };
          if (contentChars <= 0 || upstreamCost === null) return base;
          try {
            const charged = chatModels.chargedFor?.(upstreamCost) ?? null;
            if (charged !== null) base["charged"] = charged;
          } catch {
            // 表示口の失敗でストリーム自体を壊さない
          }
          return base;
        };
        // #174: 終端確定の精算口。本文0の終端も送る（index 側で全額返金にする）。
        const settled = (cost: number | null): void => {
          try {
            onSettled?.({ cost, contentChars });
          } catch {
            // 精算口の失敗でストリーム自体を壊さない
          }
        };
        if (switched)
          emit(
            switched.effort === null
              ? { type: "switched", from: switched.from, to: switched.to, reason: switched.reason, charged: true }
              : { type: "switched", from: switched.from, to: switched.to, reason: switched.reason, charged: true, effort: switched.effort },
          );
        for (const ev of prefixEvents) emit(ev);
        const emitLine = (rawLine: string): void => {
          const chunk = parseSseLine(rawLine);
          if (chunk.finishReason !== null) finishReason = chunk.finishReason;
          if (chunk.cost !== null) upstreamCost = chunk.cost;
          for (const ev of chunk.events) {
            if (ev.type === "content") contentChars += (ev.delta ?? "").length;
            emit(ev);
          }
        };
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const rawLine of lines) emitLine(rawLine);
          }
          buffer += decoder.decode();
          if (buffer.trim() !== "") emitLine(buffer);
          // #94: length は max_tokens で切れた印。空で完了させず error にする。
          if (finishReason === "length") {
            console.error(
              `upstream truncated model=${upstreamModel} max_tokens=${CHAT_MAX_TOKENS} reason=${finishReason}`,
            );
            // #172: 本文あり + 実費確定のときだけ通知文用に載せる。未確定は予約確定だが表示なし。
            emit(chargedError(TRUNCATED_CODE, { maxTokens: CHAT_MAX_TOKENS }));
            // #174: 本文0の切り詰めは予約全額返金の印だけ送る。
            if (contentChars === 0) settled(null);
          } else if (contentChars === 0) {
            // #94: length じゃないのに本文0文字。カード側は空枠だけが残って
            // 「どこも異常じゃない」状態になるので、正常終了に見せない。
            console.error(
              `upstream empty answer model=${upstreamModel} finish=${finishReason ?? "none"} events=${prefixEvents.length}`,
            );
            emit({ type: "error", code: EMPTY_ANSWER_CODE, finishReason });
            // #174: 本文0の空回答は予約全額返金の印だけ送る。
            settled(null);
          } else if (upstreamCost === null) {
            // #172: 実費未確定は予約を確定扱いにし、通知文用に載せる。
            emit(chargedDone(messageId, null, upstreamCost));
            settled(null);
          } else {
            // #169: 完了した attempt の生costだけ運ぶ（換算・表示は別タスク）。tokens は運ばない。
            emit(chargedDone(messageId, upstreamCost, upstreamCost));
            settled(upstreamCost);
          }
          controller.close();
        } catch {
          // #174: 途中の切断。本文0なら予約全額返金の印だけ送る。
          if (contentChars === 0) settled(null);
          try {
            emit({ type: "error", code: "stream_error", message: "Stream interrupted" });
          } catch {
            // enqueue不可時は閉じるのみ
          }
          controller.close();
        } finally {
          activeLink.dispose();
        }
      },
      cancel() {
        dropLink(activeLink);
        void cancelReader(reader);
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }




  if (silenceFallbackId === null) {
    const first = await postAttempt(model, null);
    if (first.kind === "abort") return cancelled();
    if (first.kind === "timeout") {
      return upstreamError(model, null, "timeout");
    } else if (first.kind !== "ok") {
      return upstreamError(model, null, previewOfError(first.error));
    } else {
      upstream = first.res;
      link = first.link;
      if (upstream.status === 404 && model !== s8Fallback) {
        console.error(
          `upstream error model=${model} status=${upstream.status} body=${await previewOf(upstream)} note=s8_switch`,
        );
        markSwitched(model, s8Fallback, "model_404");
        dropLink(link);
        const second = await postAttempt(s8Fallback, null);
        if (second.kind === "abort") return cancelled();
        if (second.kind === "timeout") return upstreamError(s8Fallback, null, "timeout");
        if (second.kind !== "ok") return upstreamError(s8Fallback, null, previewOfError(second.error));
        upstream = second.res;
        link = second.link;
        upstreamModel = s8Fallback;
      } else if (!upstream.ok) {
        const preview = await previewOf(upstream);
        const failed = upstreamModel;
        const failedStatus = upstream.status;
        dropLink(link);
        return upstreamError(failed, failedStatus, preview);
      }
    }
  } else {
    const deadline = Date.now() + timeoutMs;
    const first = await postAttempt(model, timeoutMs);
    if (first.kind === "abort") return cancelled();
    if (first.kind === "error") {
      return upstreamError(model, null, previewOfError(first.error));
    } else if (first.kind === "timeout") {
      markSwitched(model, silenceFallbackId, "timeout");
      const second = await postFallback(silenceFallbackId);
      if (second.kind === "abort") return cancelled();
      if (second.kind !== "ok") return upstreamError(silenceFallbackId, null, previewOfError(second.error));
      upstream = second.res;
      link = second.link;
    } else if (first.res.status === 404 && model !== s8Fallback) {
      console.error(
        `upstream error model=${model} status=${first.res.status} body=${await previewOf(first.res)} note=s8_switch`,
      );
      markSwitched(model, s8Fallback, "model_404");
      dropLink(first.link);
      const second = await postFallback(s8Fallback);
      if (second.kind === "abort") return cancelled();
      if (second.kind !== "ok") return upstreamError(s8Fallback, null, previewOfError(second.error));
      upstream = second.res;
      link = second.link;
      upstreamModel = s8Fallback;
    } else {
      upstream = first.res;
      link = first.link;
      if (!upstream.ok) {
        const preview = await previewOf(upstream);
        const failed = upstreamModel;
        const failedStatus = upstream.status;
        dropLink(link);
        return upstreamError(failed, failedStatus, preview);
      } else {
        const waited = await waitFirstEvent(upstream, deadline);
        if (waited.outcome === "abort") {
          await cancelReader(waited.reader);
          dropLink(link);
          return cancelled();
        } else if (waited.outcome === "timeout") {
          await cancelReader(waited.reader);
          dropLink(link);
          markSwitched(model, silenceFallbackId, "timeout");
          const second = await postFallback(silenceFallbackId);
          if (second.kind === "abort") return cancelled();
          if (second.kind !== "ok") return upstreamError(silenceFallbackId, null, previewOfError(second.error));
          upstream = second.res;
          link = second.link;
          upstreamModel = silenceFallbackId;
        } else if (waited.outcome === "event" || waited.outcome === "ended") {
          prefix = waited;
        }
      }
    }
  }

  if (!upstream.ok || !upstream.body) {
    const preview = upstream.body ? await previewOf(upstream) : "";
    const failedModel = upstreamModel;
    const status = upstream.status;
    dropLink(link);
    return upstreamError(failedModel, status, preview);
  }

  return streamWithPrefix();
}
