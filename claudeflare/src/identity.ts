// #255 OS2a: Worker access-token auth.
//
// Self-host users paste the Worker URL plus a token into panel settings, and
// threads/settings save to their own Worker. Auth is one constant-time
// compare against env `ASK_TOKEN`. On match, the token's SHA-256 hash is the
// user ID; the raw token is never stored anywhere.
//
// Bearer precedence (contract fixed by this ticket):
//   1. `ASK_TOKEN` set and Bearer matches it -> token identity
//      (no budget, no settle. No credits concept.)
//   2. Otherwise JWT verify (hosted-only path)
//   3. Neither -> anon
// A non-matching Bearer while `ASK_TOKEN` is set is 401 (never falls to anon).
// Without `ASK_TOKEN`, existing behavior (JWT verify + anon fallback) is unchanged.
//
// #262 OS4a: the JWT verifier is injected (dependency injection). This file
// never imports the hosted-only auth.ts, so the core entry (src/core.ts)
// cannot physically reach the JWT implementation. Only hosted (src/index.ts)
// passes a verifier; core without one has no JWT path at all.
import { secretEquals } from "./secret";
import { withCors } from "./cors";

/**
 * Saved-route 401. The panel watches `needLogin` to move to re-login or the
 * local-settings fallback, so keep the shape identical on hosted and core.
 */
export function needLoginJson(request: Request, status: number, error: string, allowHeaders?: string): Response {
  return withCors(request, Response.json({ error, needLogin: true }, { status }), allowHeaders);
}

/** Auth result. Routes branch on kind only. */
export type Identity =
  | { kind: "anon" }
  | { kind: "user"; sub: string }
  | { kind: "token"; userId: string }
  | { kind: "unauthorized" };

/** Slimmest env slice that needs auth. */
export interface IdentityEnv {
  ASK_TOKEN?: string;
  JWT_SECRET?: string;
}

/** Authorization: Bearer value. Bad format is empty string. */
export function bearerOf(request: Request): string {
  const h = request.headers.get("Authorization");
  return h && h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

/**
 * SHA-256 hash (hex) of the token. The raw token is never written to KV, so
 * stored Threads are owned by this hash.
 */
export async function tokenUserId(token: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  );
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** Storage user ID. Token hashes, JWT subs. anon/unauthorized are null. */
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
 * JWT verifier. Returns sub when valid, null on bad signature/expiry/format.
 * The hosted implementation (verifyJwt in src/auth.ts) is injected by the entry.
 */
export type JwtVerifier = (token: string, secret: string) => Promise<string | null>;

/** Auth injection point. Only hosted passes verifyJwt (#262 OS4a). */
export interface IdentityDeps {
  verifyJwt?: JwtVerifier;
}

/** Resolve Bearer to an Identity (per the contract above). */
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
  // A non-matching Bearer while ASK_TOKEN is set never falls back to anon.
  if (env.ASK_TOKEN) return { kind: "unauthorized" };
  // A Bearer with no verify key is anon (existing behavior).
  return { kind: "anon" };
}
