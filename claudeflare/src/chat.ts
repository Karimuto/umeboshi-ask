// S2: minimal Why?-answer streaming loop. Upstream is the single OpenRouter line (ADR 0015).
// Map upstream SSE onto StreamEvent (thinking/content/switched/done+error).
// S8: off-allowlist model is 404 + fallback id; upstream 404 auto-switches to the
// cheapest selectable model on the same upstream and emits switched first
// (charged:true + effort). Excludes S4 (anon credits).
// S9: only after 15s of total silence (neither thinking nor content) switch once
// to another model and emit switched first (reason:"timeout", charged:true + effort).
// After thinking arrives, keep waiting. Switch/interrupt usage bills actual cost
// with no display (silent attempt is aborted and dropped. Settle from charged:true on HOST/S10).
// S3: question caps at 8000 (raw question 2000 + context) as it composes template + card context.
// - max_tokens flat 8192 (#94: never varies by effort. Reasoning alone could eat it and leave zero body,
//   so truncation returns error, not done)
// - LLM output is Markdown verbatim (no JSON repair. Pass-through only)
// - order: thinking→content→done (keep upstream arrival order, done once at end)
// #66: send effort via reasoning.effort. Unspecified uses each model's default effort (no-choice sends none).
// Invalid combos stop with 400 invalid_effort. Auto-switch target uses the target's default effort.
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
/** #35: system prompt prepended for every OpenRouter call. Behavior base. */
export const CHAT_SYSTEM_PROMPT = `# Role
You are a professor who is exceptionally clear and easy to understand. Based on the provided Problem Statement, Supplementary Information, and User's Question, create a response that deepens the user's understanding of their question.`;
/** S9: deadline switching to another model after total silence (no thinking, no content). */
export const SILENCE_TIMEOUT_MS = 15_000;
/** #30: max head chars of the upstream error body kept for diagnosis. */
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

/** One parsed upstream line. finish_reason is "why upstream stopped there". */
export interface UpstreamChunk {
  /** Event rows to emit. Keeps arrival order. */
  events: { type: string; delta?: string }[];
  /** choices[0].finish_reason. Null when absent. */
  finishReason: string | null;
  /** #169: usage.cost (USD). Set only for positive finite numbers, else null. Never carries tokens. */
  cost: number | null;
}

/** Parse the data payload of one raw SSE line. Null for missing/broken lines. */
function ssePayload(rawLine: string): unknown {
  const line = rawLine.trim();
  if (!line.startsWith("data:")) return null;
  const payload = line.slice("data:".length).trim();
  if (payload === "" || payload === "[DONE]") return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null; // Drop broken lines (skip corrupt lines, not missing ones)
  }
}

/** Take (thinking/content events, finish_reason) from one upstream line. */
export function parseSseLine(rawLine: string): UpstreamChunk {
  const body = recordOf(ssePayload(rawLine));
  // #169: terminal upstream usage frame sits outside choices (usage.cost at top level).
  // OpenRouter always attaches it (stream_options is deprecated, so never sent).
  // Take only positive finite numbers; never read or carry tokens.
  const rawCost = recordOf(body?.["usage"])?.["cost"];
  const cost = typeof rawCost === "number" && Number.isFinite(rawCost) && rawCost > 0 ? rawCost : null;
  const choices = body?.["choices"];
  const choice = Array.isArray(choices) ? recordOf(choices[0]) : null;
  if (!choice) return { events: [], finishReason: null, cost };
  // #94: finish_reason lives on the choices side. Lines may carry only finish_reason with no delta.
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

/** #94: finish_reason=length marks max_tokens truncation. Never finish empty as success; return error. */
export const TRUNCATED_CODE = "truncated";
/** #94: code for "empty success" (zero body text though not cut off by length).
 *  Measured: effort=low still returns body (15/15 with body, reasoning 178-696/8192).
 *  So empty slots on low come from something other than max_tokens; the truncation theory cannot explain them. */
export const EMPTY_ANSWER_CODE = "empty_answer";


export interface ChatSettled {
  /** Raw cost of the finished attempt. Null-only at zero-body ends (full-refund mark). */
  cost: number | null;
  /** Body chars streamed to the card. Staying 0 marks a full reservation refund. */
  contentChars: number;
}

export interface ChatModels {
  /** Resolved list (cheapest first). Fixed 5-model bundle when unspecified. */
  models?: ResolvedModel[];
  /** S9 silence-deadline override (ms). Test injection. Defaults to SILENCE_TIMEOUT_MS. */
  timeoutMs?: number;
  /** #171: settle hook after the end is fixed. Called after stream end. */
  onSettled?: ((settled: ChatSettled) => void) | undefined;
  /** #172: hook computing the fixed amount on done. Reserved amount is the base; converges to actuals once fixed. */
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
  /** #94: finish_reason of lines received during the silence wait. Carried to the later stream. */
  finishReason: string | null;
  /** #169: upstream usage.cost received during the silence wait. Carried only within the same attempt (dropped on switch). */
  cost: number | null;
}

export type ChatModelDecision = { id: string } | { unknownModel: true; fallback: string };

/** body.model to fixed model id. Same check for the S4 anon-billing pre-stage and handleChat itself. */
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

/** #66 body.effort to fixed effort. Unspecified uses each model's default effort incl. switch targets (no-send no-choice is null). */
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
  /** #66 Effort to send. Auto-switch target uses the target default effort (Q9 answer). */
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

  /** Single-OpenRouter-line destination. */
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

  // Per-attempt AbortController. Propagates client abort upstream; also aborts on S9 silence timeout.
  // Dispose removes the listener after use (stale attempts must not drag aborts along).
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
      // Ignore double abort
    }
  }

  async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    try {
      await reader.cancel();
    } catch {
      // Ignore double cancel
    }
  }

  // Upstream POST. With deadline when ms is not null (S9). On timeout aborts upstream and returns timeout.
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

  // S9: wait for first-byte equivalent (thinking or content) until deadline.
  // Hand the returned reader/decoder/buffer to the final stream as-is (no resend).
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
    // Parse each line once, picking up finish_reason too (#94).
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
    // #174: interrupt means zero body, so send only the full-reservation-refund mark.
    try {
      chatModels.onSettled?.({ cost: null, contentChars: 0 });
    } catch {
      // Never break the response on a settle-hook failure
    }
    return Response.json({ error: "Request cancelled" }, { status: 499 });
  }

  // #30: take only the head of the upstream response body. Reads the clone, never consumes the original stream.
  // Even if upstream echoes request content, mask API key/Bearer/full question so no secret leaks.
  // Short matches would corrupt diagnostics, so only secrets of some length qualify.
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
  // #30: log upstream failures as model+status+body head via console.error (visible in wrangler tail),
  // and include the same safe range (status+body head+model) in the 502 JSON. Never API key/Bearer/question.
  async function upstreamError(modelId: string, status: number | null, preview: string): Promise<Response> {
    const head = preview.slice(0, UPSTREAM_ERROR_PREVIEW_MAX);
    console.error(
      `upstream error model=${modelId} status=${status === null ? "fetch_failed" : status} body=${head}`,
    );
    // #174: ended before upstream answered. Zero body, so send only the full-reservation-refund mark.
    try {
      chatModels.onSettled?.({ cost: null, contentChars: 0 });
    } catch {
      // Never break the response on a settle-hook failure
    }
    return Response.json(
      { error: "LLM upstream error", model: modelId, upstreamStatus: status, upstreamPreview: head },
      { status: 502 },
    );
  }

  // POST with a switch target (no deadline, one shot). Pass abort/error through on failure.
  async function postFallback(
    fallbackId: string,
  ): Promise<{ kind: "ok"; res: Response; link: AttemptLink } | { kind: "abort" } | { kind: "error"; error: unknown }> {
    const r = await postAttempt(fallbackId, null);
    if (r.kind === "ok") return r;
    if (r.kind === "abort") return r;
    if (r.kind === "timeout") return { kind: "error", error: "timeout" };
    return r;
  }

  // S8 switch target (cheapest selectable first). Often matches the S9 target, but differs when current is cheapest.
  const timeoutMs = chatModels.timeoutMs ?? SILENCE_TIMEOUT_MS;
  const s8Fallback = cheapestSelectable(allowed)?.id ?? defaultChatModel();
  // S9 switch target (cheapest selectable besides current). Null with a single model means no switch; keep waiting as before.
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
    // #169: upstream usage.cost of the finished attempt (latest positive finite value). Dropped attempts drop with the prefix.
    let upstreamCost: number | null = prefix?.cost ?? null;
    // #94: body chars streamed to the card. Zero body outside length is "empty success".
    let contentChars =
      prefixEvents.reduce((n, ev) => (ev.type === "content" ? n + (ev.delta ?? "").length : n), 0);

    // waitFirstEvent may have consumed the reader, so never open a new getReader here.
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
        // #172: put the fixed amount charged on done. Reserved amount is the base, converging to actuals once fixed.
        // Never called on error/truncated ends. No extra when the hook is missing.
        const chargedDone = (messageId: string, cost: number | null, rawCost: number | null): Record<string, unknown> => {
          const base: Record<string, unknown> = cost === null ? { type: "done", messageId } : { type: "done", messageId, cost: rawCost };
          try {
            const charged = chatModels.chargedFor?.(cost) ?? null;
            if (charged !== null) base["charged"] = charged;
          } catch {
            // Never break the stream on a display-hook failure
          }
          return base;
        };
        // #172: put charged on error ends only with fixed actuals. Zero body or unfixed carries none.
        const chargedError = (code: string, extra: Record<string, unknown>): Record<string, unknown> => {
          const base: Record<string, unknown> = { type: "error", code, ...extra };
          if (contentChars <= 0 || upstreamCost === null) return base;
          try {
            const charged = chatModels.chargedFor?.(upstreamCost) ?? null;
            if (charged !== null) base["charged"] = charged;
          } catch {
            // Never break the stream on a display-hook failure
          }
          return base;
        };
        // #174: settle hook on fixed end. Also sends zero-body ends (index side fully refunds).
        const settled = (cost: number | null): void => {
          try {
            onSettled?.({ cost, contentChars });
          } catch {
            // Never break the stream on a settle-hook failure
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
          // #94: length marks max_tokens truncation. Never finish empty as success; return error.
          if (finishReason === "length") {
            console.error(
              `upstream truncated model=${upstreamModel} max_tokens=${CHAT_MAX_TOKENS} reason=${finishReason}`,
            );
            // #172: notice text carries it only with body + fixed actuals. Unfixed stays reserved but hidden.
            emit(chargedError(TRUNCATED_CODE, { maxTokens: CHAT_MAX_TOKENS }));
            // #174: truncated with zero body sends only the full-reservation-refund mark.
            if (contentChars === 0) settled(null);
          } else if (contentChars === 0) {
            // #94: zero body without length. The card would keep only an empty slot and
            // look like "nothing is wrong", so never show it as success.
            console.error(
              `upstream empty answer model=${upstreamModel} finish=${finishReason ?? "none"} events=${prefixEvents.length}`,
            );
            emit({ type: "error", code: EMPTY_ANSWER_CODE, finishReason });
            // #174: empty answer with zero body sends only the full-reservation-refund mark.
            settled(null);
          } else if (upstreamCost === null) {
            // #172: unfixed actuals fix the reservation as-is and carry it for notice text.
            emit(chargedDone(messageId, null, upstreamCost));
            settled(null);
          } else {
            // #169: carry only the raw cost of the finished attempt (conversion/display is separate). Never tokens.
            emit(chargedDone(messageId, upstreamCost, upstreamCost));
            settled(upstreamCost);
          }
          controller.close();
        } catch {
          // #174: mid-stream cut. Zero body sends only the full-reservation-refund mark.
          if (contentChars === 0) settled(null);
          try {
            emit({ type: "error", code: "stream_error", message: "Stream interrupted" });
          } catch {
            // Only close when enqueue is impossible
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
