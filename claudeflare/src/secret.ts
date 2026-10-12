// #262 OS4a: 2つの秘密を定数時間で比較する。#100 穴4 の実装を auth.ts
// （完全版専用）から共有側へ移した。完全版の ADMIN_SECRET と、コア・完全版
// で共有する identity.ts の ASK_TOKEN の両方に使う。
//
// 平文比較（!==）は一致した先頭から短絡するので、一致の長さが時間差で
// 漏れる。長さが違う時点で false を返しても長さが漏るので、長い方の
// 長さまで回して XOR で差分を積み、最後に一括で 0 かどうかだけを見る。
// 途中で短絡しないので、呼び出し側からは一致の長さが分からない。
export function secretEquals(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  let diff = 0;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
