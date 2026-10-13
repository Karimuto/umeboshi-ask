// UM1 (#183): lookup returning the panel version and stop flag. Spec is #188.
//
// The Worker returns only version and stop flag. No body text.
// The current panel is addon/templates/inject.html bundled with the add-on;
// UM2 (#184) startup upgrade compares the bundled copy against this answer.
//
// - Version is SemVer (three MAJOR.MINOR.PATCH numbers). Compare with comparePanelVersion.
// - Marker (`<!-- umeboshi-ask:begin v1 -->`) stays frozen for identity; never bump it.
// - While the stop flag (stopped) is true, the add-on never picks up new versions.
// - Self-host without KV has neither version nor flag, so lookup returns unavailable.
//   Rewriting itself stops on the UM2 side via apiBase mismatch (never stops here).

/** Two KV keys the lookup reads. */
export const PANEL_RELEASE_KEY = "ask:panel:release:v1";
export const PANEL_STOP_KEY = "ask:panel:stop:v1";

/** Lookup response. No body text. */
export interface PanelRelease {
  version: string;
  stopped: boolean;
  updatedAt: string | null;
}

export interface PanelStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** SemVer check (three numbers). Rejects leading zeros, empty, four parts, suffixes. */
export function isPanelVersion(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = SEMVER_RE.exec(v);
  if (!m) return false;
  // Only numeric round-trippable parts pass (drops leading zeros like "01").
  const parts = [m[1], m[2], m[3]].map(Number);
  return parts.every((n) => Number.isSafeInteger(n) && n >= 0) && parts.join(".") === v;
}

/**
 * SemVer compare. Positive when a is newer than b, 0 when equal, negative when older.
 * Broken versions cannot compare, so return 0 (callers never pick them up).
 */
export function comparePanelVersion(a: string, b: string): number {
  if (!isPanelVersion(a) || !isPanelVersion(b)) return 0;
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] as number) - (pb[i] as number);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Lookup read. Unset/broken is null (caller returns unavailable). */
export async function readPanelRelease(store: PanelStore | undefined): Promise<PanelRelease | null> {
  if (!store) return null;
  const raw = await store.get(PANEL_RELEASE_KEY);
  if (!raw) return null;
  let rec: { version?: unknown; updatedAt?: unknown };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    rec = parsed as { version?: unknown; updatedAt?: unknown };
  } catch {
    return null;
  }
  if (!isPanelVersion(rec.version)) return null;
  // The stop flag lives on its own key. Never read stopped from the version record (never honor a flag nobody wrote).
  const stopRaw = await store.get(PANEL_STOP_KEY);
  return {
    version: rec.version,
    stopped: stopRaw === "1",
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : null,
  };
}

/**
 * Hosted-side write (HOST KV ops, tests). Same shape as the lookup response.
 * stopped goes to its own key only. The version record never carries stopped,
 * by the promise never to read it there.
 */
export async function writePanelRelease(
  store: PanelStore,
  version: string,
  opts?: { stopped?: boolean; updatedAt?: string },
): Promise<PanelRelease> {
  if (!isPanelVersion(version)) throw new Error("invalid_panel_version");
  const release: PanelRelease = {
    version,
    stopped: opts?.stopped === true,
    updatedAt: opts?.updatedAt ?? new Date().toISOString(),
  };
  await store.put(PANEL_RELEASE_KEY, JSON.stringify({ version, updatedAt: release.updatedAt }));
  if (release.stopped) {
    await store.put(PANEL_STOP_KEY, "1");
  } else {
    await store.del(PANEL_STOP_KEY);
  }
  return release;
}
