// S6: Thread storage (one Message at a time, no title, no thinking saved).
// KV: thread body `ask:thread:{userId}:{cardId}`, index `ask:thread:index:{userId}` (50 entries).
// Limits: 100 Messages per Thread, 20000 chars per Message (question+answer).
// Match: identity userId wins; x-card-id header mismatch is 400, owner mismatch is 403. Delete is immediate.
// Saved messages never go to the LLM (excluded from chat payload. ADR 0006).

export const THREAD_MSG_MAX = 100;
export const THREAD_MSG_CHARS = 20000;
export const THREAD_INDEX_MAX = 50;

export interface ThreadStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

export interface ThreadMessage {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadBody {
  cardId: string;
  ownerId: string;
  messages: ThreadMessage[];
  updatedAt: string;
}

export interface ThreadIndexEntry {
  cardId: string;
  updatedAt: string;
  count: number;
}

export function threadKey(cardId: string): string {
  return `ask:thread:${cardId}`;
}

export function threadIndexKey(userId: string): string {
  return `ask:thread:index:${userId}`;
}

export function newMessageId(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c && typeof c.randomUUID === "function") {
      return `m_${c.randomUUID().replace(/-/g, "").slice(0, 24)}`;
    }
  } catch {
    // Fall through to fallback
  }
  const r = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  return `m_${Date.now().toString(36)}${r}`;
}

/** CardID is the Anki 25.09.2+ {{CardID}} substitution result. Reject unsubstituted/empty/over-128-char. */
export function isValidCardId(cardId: unknown): cardId is string {
  if (typeof cardId !== "string") return false;
  const t = cardId.trim();
  if (t.length === 0 || t.length > 128) return false;
  if (t.indexOf("{{") !== -1 || t.indexOf("}}") !== -1) return false;
  return true;
}

/** Match x-card-id header against path/body CardID. Mismatch is 400 (D3). Missing header is ignored. */
export function cardIdMismatch(headerCardId: string | null, cardId: string): boolean {
  if (headerCardId === null) return false;
  return headerCardId.trim() !== cardId;
}

function nowIso(): string {
  return new Date().toISOString();
}

function messageLen(q: string, a: string): number {
  return q.length + a.length;
}

export function validateMessageInput(
  question: unknown,
  answer: unknown,
): { ok: true; question: string; answer: string } | { ok: false; error: string } {
  if (typeof question !== "string" || typeof answer !== "string") {
    return { ok: false, error: "question and answer are required" };
  }
  if (question.trim().length === 0) {
    return { ok: false, error: "question is required" };
  }
  if (question.length > THREAD_MSG_CHARS || answer.length > THREAD_MSG_CHARS) {
    return { ok: false, error: "message_too_long" };
  }
  if (messageLen(question, answer) > THREAD_MSG_CHARS) {
    return { ok: false, error: "message_too_long" };
  }
  return { ok: true, question, answer };
}

async function loadThreadRaw(store: ThreadStore, cardId: string): Promise<ThreadBody | null> {
  const raw = await store.get(threadKey(cardId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ThreadBody>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.messages)) return null;
    // Owner comes from the body ownerId (per-cardId keys cannot observe 403, so cardId key only).
    if (typeof parsed.ownerId !== "string" || parsed.ownerId === "") return null;
    return {
      cardId,
      ownerId: parsed.ownerId as string,
      messages: (parsed.messages as ThreadMessage[]).filter(
        (m) => m && typeof m.id === "string" && typeof m.question === "string" && typeof m.answer === "string",
      ),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso(),
    };
  } catch {
    return null;
  }
}
async function saveThreadRaw(store: ThreadStore, thread: ThreadBody): Promise<void> {
  await store.put(threadKey(thread.cardId), JSON.stringify(thread));
}

async function loadIndexRaw(store: ThreadStore, userId: string): Promise<ThreadIndexEntry[]> {
  const raw = await store.get(threadIndexKey(userId));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as ThreadIndexEntry[]).filter(
      (e) => e && typeof e.cardId === "string" && typeof e.updatedAt === "string",
    );
  } catch {
    return [];
  }
}

/** Touch index to front, 50-entry cap. Cards with count 0 drop out of the index. */
async function touchIndex(
  store: ThreadStore,
  userId: string,
  cardId: string,
  count: number,
  updatedAt: string,
): Promise<ThreadIndexEntry[]> {
  const rest = (await loadIndexRaw(store, userId)).filter((e) => e.cardId !== cardId);
  const next: ThreadIndexEntry[] =
    count > 0 ? [{ cardId, updatedAt, count }, ...rest] : rest;
  while (next.length > THREAD_INDEX_MAX) next.pop();
  await store.put(threadIndexKey(userId), JSON.stringify(next));
  return next;
}

export interface ThreadResult {
  status: number;
  body: Record<string, unknown>;
}

/** GET thread. Missing thread returns an empty Thread with 200 (for first view). */
export async function getThread(
  store: ThreadStore,
  ownerId: string,
  cardId: string,
): Promise<ThreadResult> {
  if (!isValidCardId(cardId)) {
    return { status: 400, body: { error: "invalid_cardId" } };
  }
  const thread = await loadThreadRaw(store, cardId);
  if (thread && thread.ownerId !== ownerId) {
    return { status: 403, body: { error: "forbidden" } };
  }
  return {
    status: 200,
    body: {
      cardId,
      messages: thread ? thread.messages : [],
      ...(thread ? { updatedAt: thread.updatedAt } : {}),
    },
  };
}

/** POST message (one at a time. Thinking is not accepted). */
export async function postMessage(
  store: ThreadStore,
  ownerId: string,
  cardId: string,
  question: unknown,
  answer: unknown,
): Promise<ThreadResult> {
  if (!isValidCardId(cardId)) {
    return { status: 400, body: { error: "invalid_cardId" } };
  }
  const v = validateMessageInput(question, answer);
  if (!v.ok) {
    return { status: 400, body: { error: v.error } };
  }
  const existing = await loadThreadRaw(store, cardId);
  if (existing && existing.ownerId !== ownerId) {
    return { status: 403, body: { error: "forbidden" } };
  }
  const messages = existing ? existing.messages : [];
  if (messages.length >= THREAD_MSG_MAX) {
    return { status: 400, body: { error: "thread_full" } };
  }
  const at = nowIso();
  const message: ThreadMessage = {
    id: newMessageId(),
    question: v.question,
    answer: v.answer,
    createdAt: at,
    updatedAt: at,
  };
  const thread: ThreadBody = {
    cardId,
    ownerId,
    messages: [...messages, message],
    updatedAt: at,
  };
  await saveThreadRaw(store, thread);
  await touchIndex(store, ownerId, cardId, thread.messages.length, at);
  return { status: 201, body: { message } };
}

/** PATCH message (edit. question or answer required). */
export async function patchMessage(
  store: ThreadStore,
  ownerId: string,
  cardId: string,
  messageId: string,
  question: unknown,
  answer: unknown,
): Promise<ThreadResult> {
  if (!isValidCardId(cardId)) {
    return { status: 400, body: { error: "invalid_cardId" } };
  }
  if (typeof messageId !== "string" || messageId.length === 0) {
    return { status: 400, body: { error: "invalid_messageId" } };
  }
  const thread = await loadThreadRaw(store, cardId);
  if (!thread) {
    return { status: 404, body: { error: "not_found" } };
  }
  if (thread.ownerId !== ownerId) {
    return { status: 403, body: { error: "forbidden" } };
  }
  const idx = thread.messages.findIndex((m) => m.id === messageId);
  if (idx < 0) {
    return { status: 404, body: { error: "not_found" } };
  }
  const cur = thread.messages[idx]!;
  const nextQ = question === undefined ? cur.question : question;
  const nextA = answer === undefined ? cur.answer : answer;
  const v = validateMessageInput(nextQ, nextA);
  if (!v.ok) {
    return { status: 400, body: { error: v.error } };
  }
  const at = nowIso();
  const updated: ThreadMessage = {
    ...cur,
    question: v.question,
    answer: v.answer,
    updatedAt: at,
  };
  const messages = [...thread.messages];
  messages[idx] = updated;
  const next: ThreadBody = { cardId, ownerId, messages, updatedAt: at };
  await saveThreadRaw(store, next);
  await touchIndex(store, ownerId, cardId, messages.length, at);
  return { status: 200, body: { message: updated } };
}

/** DELETE message (no restore, immediate delete. Empty Thread body is removed too). */
export async function deleteMessage(
  store: ThreadStore,
  ownerId: string,
  cardId: string,
  messageId: string,
): Promise<ThreadResult> {
  if (!isValidCardId(cardId)) {
    return { status: 400, body: { error: "invalid_cardId" } };
  }
  if (typeof messageId !== "string" || messageId.length === 0) {
    return { status: 400, body: { error: "invalid_messageId" } };
  }
  const thread = await loadThreadRaw(store, cardId);
  if (!thread) {
    return { status: 404, body: { error: "not_found" } };
  }
  if (thread.ownerId !== ownerId) {
    return { status: 403, body: { error: "forbidden" } };
  }
  const before = thread.messages.length;
  const messages = thread.messages.filter((m) => m.id !== messageId);
  if (messages.length === before) {
    return { status: 404, body: { error: "not_found" } };
  }
  const at = nowIso();
  if (messages.length === 0) {
    await store.del(threadKey(cardId));
  } else {
    await saveThreadRaw(store, { cardId, ownerId, messages, updatedAt: at });
  }
  await touchIndex(store, ownerId, cardId, messages.length, at);
  return { status: 200, body: { deleted: true } };
}

/** GET index (50-entry cap, newest first). */
export async function getThreadIndex(store: ThreadStore, ownerId: string): Promise<ThreadResult> {
  const entries = await loadIndexRaw(store, ownerId);
  return { status: 200, body: { threads: entries.slice(0, THREAD_INDEX_MAX) } };
}
