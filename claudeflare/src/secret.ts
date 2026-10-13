// #262 OS4a: constant-time compare for two secrets. Moved from auth.ts
// (hosted-only) to shared code. Used for both the hosted ADMIN_SECRET and
// the ASK_TOKEN in identity.ts shared by core and hosted.
//
// Plain compare (!==) short-circuits at the first matching byte, so match
// length leaks through timing. Returning false early on length mismatch also
// leaks length, so loop up to the longer length, accumulate XOR diffs, and
// check for zero once at the end. No early exit hides the match length.
export function secretEquals(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  let diff = 0;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
