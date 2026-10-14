/**
 * 记忆检索打分（DESIGN.md §50）。中文没有空格，按词切不动，所以用「整句包含 + 双字重合 + 英文词重合」打分：
 * 不需要向量模型，也不依赖数据库扩展；一个人最多几千条，在内存里算足够快。
 */
export type Scorable = { subject: string | null; content: string; context: string | null };

const norm = (text: string) => text.toLocaleLowerCase().replace(/\s+/g, " ").trim();

/** 中文按双字，拉丁字母和数字按整词。 */
export function grams(text: string): Set<string> {
  const out = new Set<string>();
  const value = norm(text);
  for (const word of value.match(/[a-z0-9][a-z0-9._@+-]*/g) ?? []) if (word.length > 1) out.add(word);
  const cjk = value.replace(/[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu, " ");
  for (const run of cjk.split(" ")) {
    if (run.length === 1) out.add(run);
    for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
  }
  return out;
}

/** 0–1。0.25 以上算相关；完全包含查询词的直接 ≥ 0.8。 */
export function score(query: string, note: Scorable): number {
  const q = norm(query);
  if (!q) return 0;
  const subject = norm(note.subject ?? "");
  const body = norm(`${note.content} ${note.context ?? ""}`);
  if (subject && (subject === q || subject.includes(q) || q.includes(subject))) return 1;
  if (body.includes(q)) return 0.85;
  const qg = grams(q);
  if (!qg.size) return 0;
  const hay = grams(`${subject} ${subject} ${body}`);
  let hit = 0;
  for (const g of qg) if (hay.has(g)) hit++;
  return (hit / qg.size) * 0.8;
}

export const RELEVANT = 0.25;
