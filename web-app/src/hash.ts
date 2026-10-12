/** 32-bit FNV-1a over UTF-8 bytes; mirrors fnv1a() in scripts/web_playable.py. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(text)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
