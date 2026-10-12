// UM1 (#183): panel の版と停止旗を返す照会口。仕様は spec #188。
//
// Worker が返すのは版番号と停止旗だけ。本文は返さない。
// 正の panel は add-on 同梱の addon/templates/inject.html であり、
// 照会の答えは UM2 (#184) の起動時 upgrade が同梱との比較に使う。
//
// - 版は SemVer（MAJOR.MINOR.PATCH の数字3点）。前後比較は comparePanelVersion。
// - 印（`<!-- umeboshi-ask:begin v1 -->`）は身元確認のまま凍結し、上げない。
// - 停止旗（stopped）が真のとき add-on は新版を拾わない。
// - 自力デプロイ（KVなし）は版も旗も持たないので、照会は unavailable を返す。
//   書換え自体は UM2 側が apiBase の不一致で止める（ここでは止めない）。

/** 照会口が KV から読むふたつの鍵。 */
export const PANEL_RELEASE_KEY = "ask:panel:release:v1";
export const PANEL_STOP_KEY = "ask:panel:stop:v1";

/** 照会口の応答。本文は含まない。 */
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

/** SemVer（数字3点）の検査。先行ゼロ・空・4点・接尾辞は受けない。 */
export function isPanelVersion(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = SEMVER_RE.exec(v);
  if (!m) return false;
  // 数値化して戻せるものだけ通す（"01" のような先行ゼロを落とす）。
  const parts = [m[1], m[2], m[3]].map(Number);
  return parts.every((n) => Number.isSafeInteger(n) && n >= 0) && parts.join(".") === v;
}

/**
 * SemVer の前後比較。a が b より新しければ正、同じなら 0、古ければ負。
 * 壊れた版は比べられないので 0 を返す（呼び出し側は拾わない）。
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

/** 照会口の読み取り。未設定・壊れは null（呼び出し側が unavailable を返す）。 */
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
  // 停止旗は別鍵が正。版レコード内の stopped は読まない（書いた覚えのない旗は倒さない）。
  const stopRaw = await store.get(PANEL_STOP_KEY);
  return {
    version: rec.version,
    stopped: stopRaw === "1",
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : null,
  };
}

/**
 * 運用側の書き込み（HOST の KV 操作・テスト用）。照会の応答形そのまま。
 * stopped は別鍵にだけ書く。版レコード内の stopped は読まない約束のため、
 * ここでも版レコード側には stopped を書かない。
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
