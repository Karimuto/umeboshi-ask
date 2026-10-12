// #255 OS2a: Worker のアクセストークン認証。
//
// 自己ホスト利用者は面板の設定に Worker URL とトークンを貼るだけで
// threads・settings を自分の Worker に保存できる。認証は env の
// `ASK_TOKEN` 1本との定時間比較。一致したら「そのトークンの SHA-256
// ハッシュ」をユーザー ID として使い、token の生値はどこにも保存しない。
//
// Bearer の解釈順（この ticket で確定させる契約）:
//   1. `ASK_TOKEN` が設定されていて Bearer がそれと一致 → token identity
//      （予算も精算も通さない。credits 概念を持たない）
//   2. 一致しなければ JWT 検証（完全版だけの経路）
//   3. どちらでもなければ匿名
// `ASK_TOKEN` 設定時に不一致の Bearer が来たら 401（匿名に落とさない）。
// `ASK_TOKEN` 未設定のときの既存挙動（JWT 検証・匿名フォールバック）は変えない。
//
// #262 OS4a: JWT の検証器は外から注入する（依存注入）。このファイルは
// 完全版専用の auth.ts を import しないので、コア入口 (src/core.ts) は
// JWT の実装へ物理的に到達できない。検証器を渡すのは完全版 (src/index.ts)
// だけで、渡さないコアでは JWT 検証の経路そのものが存在しない。
import { secretEquals } from "./secret";
import { withCors } from "./cors";

/**
 * 保存系の 401。面板は `needLogin` を見て再ログイン・ローカル設定への
 * フォールバックへ移るので、形は完全版入口・コア入口で同一にする。
 */
export function needLoginJson(request: Request, status: number, error: string): Response {
  return withCors(request, Response.json({ error, needLogin: true }, { status }));
}

/** 認証の結論。route は kind だけ見て分岐する。 */
export type Identity =
  | { kind: "anon" }
  | { kind: "user"; sub: string }
  | { kind: "token"; userId: string }
  | { kind: "unauthorized" };

/** 認証が要る env の最も薄い断面。 */
export interface IdentityEnv {
  ASK_TOKEN?: string;
  JWT_SECRET?: string;
}

/** Authorization: Bearer の値。形式不符は空文字。 */
export function bearerOf(request: Request): string {
  const h = request.headers.get("Authorization");
  return h && h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

/**
 * token の SHA-256 ハッシュ（hex）。token 自体は KV に書かないので、
 * 保存された Threads の所有者 ID はこのハッシュになる。
 */
export async function tokenUserId(token: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  );
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** 保存系のユーザー ID。token はハッシュ・JWT は sub。anon・ unauthorized は null。 */
export async function storageUserId(
  request: Request,
  env: IdentityEnv,
  deps: IdentityDeps = {},
): Promise<string | null> {
  const identity = await resolveIdentity(request, env, deps);
  if (identity.kind === "token") return identity.userId;
  if (identity.kind === "user") return identity.sub;
  return null;
}

/**
 * JWT 検証器。有効なら sub、署名不正・期限切れ・形式不正なら null。
 * 完全版の実装 (src/auth.ts の verifyJwt) を入口から注入する。
 */
export type JwtVerifier = (token: string, secret: string) => Promise<string | null>;

/** 認証の依存注入口。完全版だけが verifyJwt を渡す（#262 OS4a）。 */
export interface IdentityDeps {
  verifyJwt?: JwtVerifier;
}

/** Bearer を解釈して Identity を返す（上の契約どおり）。 */
export async function resolveIdentity(
  request: Request,
  env: IdentityEnv,
  deps: IdentityDeps = {},
): Promise<Identity> {
  const token = bearerOf(request);
  if (token === "") return { kind: "anon" };
  if (env.ASK_TOKEN && secretEquals(token, env.ASK_TOKEN)) {
    return { kind: "token", userId: await tokenUserId(token) };
  }
  if (env.JWT_SECRET && deps.verifyJwt) {
    const sub = await deps.verifyJwt(token, env.JWT_SECRET);
    if (sub) return { kind: "user", sub };
    return { kind: "unauthorized" };
  }
  // ASK_TOKEN 設定時に不一致の Bearer は匿名に落とさない。
  if (env.ASK_TOKEN) return { kind: "unauthorized" };
  // 検証鍵が何もない Bearer は匿名扱い（既存挙動）。
  return { kind: "anon" };
}
