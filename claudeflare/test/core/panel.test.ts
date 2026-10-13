// #260 OS3b: panel is a core-entry (src/core.ts) route. The full build calls the same
// readPanelRelease, so behavior is shared, but the entry here targets core.
import { describe, expect, it } from "vitest";
import { handleCoreRequest } from "../../src/core";
import { memoryStore } from "../../src/stores";
import {
  comparePanelVersion,
  isPanelVersion,
  readPanelRelease,
  writePanelRelease,
} from "../../src/panel";

function get(path: string, init?: RequestInit): Request {
  return new Request(`https://ask.example${path}`, init);
}

describe("UM1 (#183) panel version validation", () => {
  it("数字3点だけを通す", () => {
    expect(isPanelVersion("1.3.15")).toBe(true);
    expect(isPanelVersion("0.0.0")).toBe(true);
    for (const bad of ["", "1", "1.3", "1.3.15.0", "v1.3.15", "1.3.15-beta", "01.3.15", "1.3.x", "1.3.-1", null, 1315]) {
      expect(isPanelVersion(bad)).toBe(false);
    }
  });

  it("版の前後を比べられる", () => {
    expect(comparePanelVersion("1.3.15", "1.3.15")).toBe(0);
    expect(comparePanelVersion("1.3.16", "1.3.15")).toBeGreaterThan(0);
    expect(comparePanelVersion("1.3.14", "1.3.15")).toBeLessThan(0);
    expect(comparePanelVersion("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(comparePanelVersion("1.10.0", "1.9.9")).toBeGreaterThan(0);
  });

  it("壊れた版は比べず0を返す", () => {
    expect(comparePanelVersion("nope", "1.3.15")).toBe(0);
    expect(comparePanelVersion("1.3.15", "nope")).toBe(0);
  });
});

describe("UM1 (#183) GET /api/ask/panel", () => {
  it("KVなし自力デプロイは unavailable を返す", async () => {
    const res = await handleCoreRequest(get("/api/ask/panel"), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unavailable: true });
  });

  it("版と停止旗を返す。本文は返さない", async () => {
    const store = memoryStore();
    await store.put("ask:panel:release:v1", JSON.stringify({ version: "1.3.15", updatedAt: "2026-10-07T00:00:00.000Z" }));
    const res = await handleCoreRequest(get("/api/ask/panel"), {}, { store });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.version).toBe("1.3.15");
    expect(body.stopped).toBe(false);
    expect(body.updatedAt).toBe("2026-10-07T00:00:00.000Z");
    expect(body).not.toHaveProperty("panel");
    expect(body).not.toHaveProperty("html");
  });

  it("停止旗の別鍵が真のとき stopped が立つ", async () => {
    const store = memoryStore();
    await store.put("ask:panel:release:v1", JSON.stringify({ version: "1.3.15" }));
    await store.put("ask:panel:stop:v1", "1");
    const res = await handleCoreRequest(get("/api/ask/panel"), {}, { store });
    const body = (await res.json()) as { stopped: boolean };
    expect(body.stopped).toBe(true);
  });

  it("版レコード内の stopped は読まない（別鍵が正）", async () => {
    const store = memoryStore();
    await store.put("ask:panel:release:v1", JSON.stringify({ version: "1.3.15", stopped: true }));
    const res = await handleCoreRequest(get("/api/ask/panel"), {}, { store });
    const body = (await res.json()) as { stopped: boolean };
    expect(body.stopped).toBe(false);
  });

  it("未設定・壊れ・非SemVerは unavailable", async () => {
    const empty = await handleCoreRequest(get("/api/ask/panel"), {}, { store: memoryStore() });
    expect(await empty.json()).toEqual({ unavailable: true });
    for (const raw of ["not-json", JSON.stringify({ version: "v1" }), JSON.stringify({})]) {
      const store = memoryStore();
      await store.put("ask:panel:release:v1", raw);
      const res = await handleCoreRequest(get("/api/ask/panel"), {}, { store });
      expect(await res.json()).toEqual({ unavailable: true });
    }
  });
});

describe("UM1 (#183) writePanelRelease", () => {
  it("停止旗は別鍵にだけ書く", async () => {
    const store = memoryStore();
    await writePanelRelease(store, "1.3.15", { stopped: true, updatedAt: "2026-10-07T00:00:00.000Z" });
    const raw = await store.get("ask:panel:release:v1");
    expect(raw).toBe(JSON.stringify({ version: "1.3.15", updatedAt: "2026-10-07T00:00:00.000Z" }));
    expect(await store.get("ask:panel:stop:v1")).toBe("1");
    const release = await readPanelRelease(store);
    expect(release).toEqual({ version: "1.3.15", stopped: true, updatedAt: "2026-10-07T00:00:00.000Z" });
  });

  it("旗を戻すと別鍵が消える", async () => {
    const store = memoryStore();
    await writePanelRelease(store, "1.3.15", { stopped: true });
    await writePanelRelease(store, "1.3.16", { stopped: false });
    expect(await store.get("ask:panel:stop:v1")).toBeNull();
    const release = await readPanelRelease(store);
    expect(release?.version).toBe("1.3.16");
    expect(release?.stopped).toBe(false);
  });

  it("非SemVerの書き込みは落とす", async () => {
    await expect(writePanelRelease(memoryStore(), "v1")).rejects.toThrow("invalid_panel_version");
  });
});
