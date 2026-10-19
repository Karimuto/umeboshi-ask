import { describe, it } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { panelScript } from "./lib/panel-script.mjs";

// Image-context e2e matrix: card imgs in, chat body out, save marks only.
// vm-driven panel, stubbed fetch. No browser harness here either.
// Rows: IO / answer-side / 4-plus / oversize / external / imageless,
// plus save-bytes and incapable-model block guidance.

const SCRIPT = panelScript();

const IDS = [
  "umeboshi-ask",
  "umeboshi-ask-send-btn", "umeboshi-ask-save-btn", "umeboshi-ask-cardid-banner",
  "umeboshi-ask-storage-banner",
  "umeboshi-ask-consent-modal", "umeboshi-ask-settings-modal", "umeboshi-ask-models-status",
  "umeboshi-ask-input", "umeboshi-ask-settings-body",
  "umeboshi-ask-card-id", "umeboshi-ask-buttons", "umeboshi-ask-model",
  "umeboshi-ask-model-popup", "umeboshi-ask-model-backdrop", "umeboshi-ask-model-sheet", "umeboshi-ask-model-sheet-head",
  "umeboshi-ask-model-sheet-title", "umeboshi-ask-model-close", "umeboshi-ask-model-back", "umeboshi-ask-model-list", "umeboshi-ask-model-label",
  "umeboshi-ask-effort-popup", "umeboshi-ask-effort-backdrop", "umeboshi-ask-effort-sheet", "umeboshi-ask-effort-sheet-head",
  "umeboshi-ask-effort-sheet-title", "umeboshi-ask-effort-close", "umeboshi-ask-effort-list", "umeboshi-ask-effort-note",
  "umeboshi-ask-tier-popup", "umeboshi-ask-tier-backdrop", "umeboshi-ask-tier-sheet",
  "umeboshi-ask-tier-sheet-head", "umeboshi-ask-tier-sheet-title", "umeboshi-ask-tier-close",
  "umeboshi-ask-tier-list", "umeboshi-ask-tier-foot", "umeboshi-ask-tier-detail-btn",
  "umeboshi-ask-settings-btn", "umeboshi-ask-settings-close", "umeboshi-ask-prompt-list",
  "umeboshi-ask-custom-list", "umeboshi-ask-current", "umeboshi-ask-thinking",
  "umeboshi-ask-thinking-body", "umeboshi-ask-answer", "umeboshi-ask-stream-status", "umeboshi-ask-stream-q",
  "umeboshi-ask-thread", "umeboshi-ask-thread-list", "umeboshi-ask-thread-status", "umeboshi-ask-messages",
  "umeboshi-ask-drawer", "umeboshi-ask-search-clear", "umeboshi-ask-lang-status",
  "umeboshi-ask-reset-all", "umeboshi-ask-reset-prompts",
  "umeboshi-ask-title-sendmode", "umeboshi-ask-title-consent", "umeboshi-ask-title-reset",
  "umeboshi-ask-title-lang", "umeboshi-ask-title-account", "umeboshi-ask-title-migrate",
  "umeboshi-ask-title-credit", "umeboshi-ask-title-billing",
  "umeboshi-ask-title-workerurl", "umeboshi-ask-title-workertoken",
  "umeboshi-ask-worker-url", "umeboshi-ask-worker-url-note",
  "umeboshi-ask-worker-token", "umeboshi-ask-worker-token-note",
  "umeboshi-ask-sendmode-button", "umeboshi-ask-sendmode-enter",
  "umeboshi-ask-lang-radio-auto", "umeboshi-ask-lang-radio-ja", "umeboshi-ask-lang-radio-en",
  "umeboshi-ask-consent-state", "umeboshi-ask-account-state",
  "umeboshi-ask-prompts-note", "umeboshi-ask-billing-note",
  "umeboshi-ask-consent-status",
  "umeboshi-ask-age-check", "umeboshi-ask-age-check-label", "umeboshi-ask-withdraw-note",
  "umeboshi-ask-consent-agree", "umeboshi-ask-consent-later", "umeboshi-ask-consent-withdraw", "umeboshi-ask-consent-title",
  "umeboshi-ask-consent-body",
  "umeboshi-ask-send-hint", "umeboshi-ask-settings-tabs", "umeboshi-ask-settings-search",
  "umeboshi-ask-search-hint", "umeboshi-ask-detailbar", "umeboshi-ask-detail-back",
  "umeboshi-ask-detail-src", "umeboshi-ask-detail-title", "umeboshi-ask-results",
  "umeboshi-ask-input-row",
  "umeboshi-ask-credit-status", "umeboshi-ask-credit-refresh", "umeboshi-ask-credit-notice",
  "umeboshi-ask-billing-btn", "umeboshi-ask-billing-login-hint", "umeboshi-ask-billing-status",
  "umeboshi-ask-auth-status", "umeboshi-ask-account-status", "umeboshi-ask-addon-guide",
  "umeboshi-ask-login-btn", "umeboshi-ask-logout-btn", "umeboshi-ask-redeem-row",
  "umeboshi-ask-code-input", "umeboshi-ask-redeem-btn", "umeboshi-ask-export-btn",
  "umeboshi-ask-import-btn", "umeboshi-ask-migrate-status", "umeboshi-ask-migrate-login-hint",
  "raw-text", "text", "extra",
];

class FakeEl {
  constructor(id = "") {
    this.id = id;
    this.hidden = false;
    this.innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.disabled = false;
    this.checked = false;
    this.title = "";
    this.type = "";
    this.children = [];
    this.parentNode = null;
    this._ls = {};
    this.style = {};
    this.className = "";
    this.dataset = {};
    this.selectedIndex = -1;
  }
  get firstChild() { return this.children[0] || null; }
  addEventListener(t, fn) { (this._ls[t] = this._ls[t] || []).push(fn); }
  removeEventListener() {}
  click() { for (const fn of this._ls["click"] || []) fn.call(this, { target: this }); }
  appendChild(c) { if (c) { this.children.push(c); c.parentNode = this; } return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  setAttribute(k, v) { this["attr_" + k] = String(v); if (k === "disabled") this.disabled = true; }
  getAttribute(k) { return this["attr_" + k] ?? null; }
  removeAttribute(k) { delete this["attr_" + k]; if (k === "disabled") this.disabled = false; }
  querySelector() { return null; }
  contains(el) { return (this.children || []).indexOf(el) >= 0; }
  querySelectorAll() { return []; }
  scrollIntoView() {}
  get classList() {
    return { add: () => {}, remove: () => {}, contains: () => false };
  }
}

function makeMemory(init = {}) {
  const data = { ...init };
  return {
    getItem(k) { return k in data ? data[k] : null; },
    setItem(k, v) { data[k] = String(v); },
    removeItem(k) { delete data[k]; },
  };
}

function resp(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
const sseLine = (obj) => "data: " + JSON.stringify(obj);
const sseResp = (lines) => ({
  ok: true, status: 200,
  text: async () => lines.join("\n"), json: async () => ({}),
});
const tick = async (n = 8) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

const fakeImg = (src, own = false) => ({
  getAttribute: (k) => (k === "src" ? src : null), own,
});
const imgBytes = () => ({
  ok: true, status: 200,
  arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
});

async function drive(opts = {}) {
  const {
    cardImgs = [],
    localInit = {},
    models = [{ id: "m-img", name: "Img", supportsImages: true }],
    imgFetch = async () => imgBytes(),
    chat = async () => sseResp([sseLine({ type: "done" })]),
  } = opts;
  const els = {};
  for (const id of IDS) els[id] = new FakeEl(id);
  els["umeboshi-ask-card-id"].textContent = "1234567890123";
  els["umeboshi-ask-consent-modal"].hidden = true;
  els["umeboshi-ask-settings-modal"].hidden = true;
  els["umeboshi-ask-model-popup"].hidden = true;
  els["umeboshi-ask-effort-popup"].hidden = true;
  els["umeboshi-ask-tier-popup"].hidden = true;
  els["raw-text"].textContent = "";
  for (const img of cardImgs) if (img && img.own) els["umeboshi-ask"].appendChild(img);

  const local = makeMemory({
    "umeboshi-ask:worker-token:v1": "t",
    ...localInit,
  });
  const calls = [];
  const fetchStub = async (url, init) => {
    const u = String(url);
    let r;
    if (u.endsWith("/api/ask/models")) r = resp(200, { models });
    else if (u.endsWith("/api/ask/chat")) r = await chat(u, init, calls);
    else if (u.includes("/api/ask/threads/") && init?.method === "POST") {
      const b = JSON.parse(init.body);
      r = resp(200, { message: { id: "m1", question: b.question, answer: b.answer } });
    } else if (!/^https?:\/\//.test(u)) r = await imgFetch(u, init);
    else r = resp(404, {});
    calls.push({ url: u, init });
    return r;
  };
  for (const key of ["why", "what", "significance", "origin", "eli5"]) {
    const b = new FakeEl("");
    b.setAttribute("data-ask", key);
    els["umeboshi-ask-buttons"].appendChild(b);
  }
  const doc = {
    getElementById: (id) => els[id] || null,
    createElement: () => new FakeEl(""),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    querySelectorAll: (sel) => {
      if (typeof sel === "string" && sel.includes("#umeboshi-ask-buttons") && sel.includes("data-ask")) {
        const box = els["umeboshi-ask-buttons"];
        const customOnly = sel.includes("data-ask-custom");
        return (box?.children || []).filter((c) => customOnly
          ? c.getAttribute("data-ask-custom")
          : c.getAttribute("data-ask"));
      }
      if (sel === "img") return cardImgs;
      return [];
    },
    querySelector: () => null,
    addEventListener: () => {},
    body: { className: "" },
    _cookie: "",
    get cookie() { return this._cookie; },
    set cookie(v) { this._cookie = String(v).split(";")[0]; },
  };
  const sandbox = {
    console, Promise, JSON, Date, Math, Object, Array, String,
    Number, Boolean, RegExp, Error, setTimeout, clearTimeout,
    TextDecoder, AbortController, Uint8Array, ArrayBuffer, btoa,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = doc;
  sandbox.fetch = fetchStub;
  sandbox.localStorage = local;
  sandbox.location = { port: "" };
  sandbox.navigator = { language: "ja-JP", userAgent: "" };
  sandbox.UMEBOSHI_ASK_API_BASE = "https://test.example";
  sandbox.open = () => {};
  sandbox.confirm = () => true;
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox, { filename: "askScaffold.js" });
  await tick();
  await tick(12);
  return {
    sandbox, els, local, calls,
    chatBody: () => {
      const c = calls.filter((x) => x.url.endsWith("/api/ask/chat")).at(-1);
      return c ? JSON.parse(c.init.body) : null;
    },
    savedBody: () => {
      const c = calls.filter(
        (x) => x.url.includes("/api/ask/threads/") && x.init?.method === "POST",
      ).at(-1);
      return c ? JSON.parse(c.init.body) : null;
    },
    async ask(key) {
      const box = els["umeboshi-ask-buttons"];
      const btn = box.children.find((c) => c.getAttribute("data-ask") === key);
      for (const fn of box._ls["click"] || []) fn.call(box, { target: btn });
      await tick(12);
    },
  };
}

// The 6-row matrix: card imgs in, chat-body images out.
describe("image e2e: 6-row matrix", () => {
  it("IO row: image parts ride upstream", async () => {
    const h = await drive({ cardImgs: [fakeImg("io1.png")] });
    await h.ask("why");
    const b = h.chatBody();
    assert.ok(Array.isArray(b.images), "no images: " + JSON.stringify(b));
    assert.equal(b.images.length, 1);
    assert.ok(b.images[0].startsWith("data:image/png;base64,"));
  });

  it("answer-side row: answer-document images ride too", async () => {
    const h = await drive({ cardImgs: [fakeImg("ans1.png")] });
    await h.ask("why");
    const b = h.chatBody();
    assert.ok(Array.isArray(b.images), "no images: " + JSON.stringify(b));
    assert.equal(b.images.length, 1);
    assert.ok(b.images[0].startsWith("data:image/png;base64,"));
  });

  it("4-plus row: only the first 3 parts", async () => {
    const imgs = [fakeImg("p1.png"), fakeImg("p2.png"), fakeImg("p3.png"), fakeImg("p4.png")];
    const seen = [];
    const h = await drive({
      cardImgs: imgs,
      imgFetch: async (u) => { seen.push(u); return imgBytes(); },
    });
    await h.ask("why");
    const b = h.chatBody();
    assert.equal(b.images.length, 3);
    assert.ok(!seen.some((u) => u.includes("p4.png")), "fetched the 4th: " + seen);
  });

  it("oversize row: a big image still rides up (the Worker 400s it)", async () => {
    const h = await drive({
      cardImgs: [fakeImg("big1.png")],
      // Real PNG head, 11MB body: sniff reads png and passes; size falls to the Worker gate.
      imgFetch: async () => ({
        ok: true, status: 200, arrayBuffer: async () => {
          const b = new Uint8Array(11 * 1024 * 1024);
          b.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
          return b.buffer;
        },
      }),
    });
    await h.ask("why");
    const b = h.chatBody();
    assert.equal(b.images.length, 1, "big image never rode up: " + JSON.stringify(Object.keys(b || {})));
    assert.ok(b.images[0].length - b.images[0].indexOf(",") - 1 > 10 * 1024 * 1024, "not over 10MB");
  });

  it("external row: external URLs ride text-only", async () => {
    const fetched = [];
    const h = await drive({
      cardImgs: [fakeImg("https://x.example/b.png")],
      imgFetch: async (u) => { fetched.push(u); return imgBytes(); },
    });
    await h.ask("why");
    assert.ok(!("images" in h.chatBody()), "external image rode: " + JSON.stringify(h.chatBody()));
    assert.deepEqual(fetched, [], "fetched external: " + fetched);
  });

  it("imageless row: text-only, no images key", async () => {
    const h = await drive({});
    await h.ask("why");
    assert.ok(!("images" in h.chatBody()), "images rode without imgs: " + JSON.stringify(h.chatBody()));
  });
});

describe("image e2e: save mark and block guidance", () => {
  it("the save keeps [N images] only, never bytes", async () => {
    const h = await drive({ cardImgs: [fakeImg("pic1.png")] });
    await h.ask("why");
    h.sandbox.UmeboshiAskThread.save("Q?", "A.", null, 1);
    await tick(12);
    const saved = h.savedBody();
    assert.ok(saved, "no save ran");
    assert.match(saved.question, /\[画像1枚\]/);
    assert.ok(!JSON.stringify(saved).includes("data:image/"), "image bytes rode the save");
  });

  it("an incapable model plus images blocks with guidance", async () => {
    const h = await drive({
      cardImgs: [fakeImg("pic1.png")],
      models: [{ id: "m-text", name: "Text", supportsImages: false }],
    });
    await h.ask("why");
    assert.equal(h.calls.filter((c) => c.url.endsWith("/api/ask/chat")).length, 0, "sent without a block");
    assert.match(h.els["umeboshi-ask-stream-status"].textContent, /画像に対応したモデル/);
  });

  it("an upstream 400 invalid_image reads as limit guidance", async () => {
    const h = await drive({
      cardImgs: [fakeImg("big1.png")],
      imgFetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array(11 * 1024 * 1024).buffer }),
      chat: async () => resp(400, { error: "invalid_image" }),
    });
    await h.ask("why");
    // Guidance, not a code. The 3/10MB/format wording shows.
    assert.match(h.els["umeboshi-ask-stream-status"].textContent, /3枚/);
    assert.doesNotMatch(h.els["umeboshi-ask-stream-status"].textContent, /invalid_image/);
  });
});
