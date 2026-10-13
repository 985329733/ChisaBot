import { describe, expect, test } from "bun:test";
import { initialReveal, MAX_LAG_MS, pending, receive, type RevealState, snapCut, step } from "./smooth-reveal";

const PARA = "法兰克福位于德国中西部的美因河畔，是欧洲重要的金融中心和交通枢纽。".repeat(8);

/** 模拟实测到的上游节奏：每 200ms 到一批 ~20 字；界面 60 帧/秒。 */
function simulate(text: string, burst = 20, every = 200, frame = 1000 / 60) {
  let s: RevealState = initialReveal("", 0);
  const arrivals: Array<[number, number]> = []; // [time, length]
  const frames: Array<[number, number]> = []; // [time, cut]
  let t = 0;
  let got = 0;
  let nextArrival = 0;
  while (got < text.length || pending(s)) {
    if (got < text.length && t >= nextArrival) {
      got = Math.min(text.length, got + burst);
      s = receive(s, text.slice(0, got), t);
      arrivals.push([t, got]);
      nextArrival += every;
    }
    s = step(s, t);
    frames.push([t, s.cut]);
    t += frame;
    if (t > 120_000) throw new Error("never caught up");
  }
  return { s, arrivals, frames, end: t };
}

describe("smooth reveal", () => {
  test("history mounted with text shows it whole at once", () => {
    const s = initialReveal(PARA, 0);
    expect(s.cut).toBe(PARA.length);
    expect(pending(s)).toBe(false);
  });

  test("bursty input comes out as many small steps instead of a few big jumps", () => {
    const { frames, s } = simulate(PARA);
    expect(s.cut).toBe(PARA.length);
    const changes: number[] = [];
    for (let i = 1; i < frames.length; i++) if (frames[i]![1] !== frames[i - 1]![1]) changes.push(frames[i]![1] - frames[i - 1]![1]);
    // 原样显示是每 200ms 一跳 20 字；平滑后每帧只放 1–几个字。
    const bursts = Math.ceil(PARA.length / 20);
    expect(changes.length).toBeGreaterThan(bursts * 4);
    expect(Math.max(...changes)).toBeLessThanOrEqual(8);
  });

  test("never more than MAX_LAG_MS behind what has arrived", () => {
    const { frames, arrivals } = simulate(PARA, 25, 180);
    for (const [at, len] of arrivals) {
      const shown = frames.find(([t, cut]) => t >= at && cut >= len);
      expect(shown).toBeDefined();
      expect(shown![0] - at).toBeLessThanOrEqual(MAX_LAG_MS + 17);
    }
  });

  test("one huge chunk (non-streaming model) still finishes within the lag bound", () => {
    let s = receive(initialReveal("", 0), PARA, 0);
    let t = 0;
    while (pending(s)) {
      t += 16;
      s = step(s, t);
    }
    expect(t).toBeLessThanOrEqual(MAX_LAG_MS + 16);
  });

  test("an idle gap does not turn into one big step when text resumes", () => {
    let s = receive(initialReveal("", 0), "你好", 0);
    for (let t = 16; t < 2000; t += 16) s = step(s, t);
    expect(pending(s)).toBe(false);
    s = receive(s, `你好${"世界".repeat(20)}`, 5000);
    s = step(s, 5016);
    expect(s.cut - 2).toBeLessThanOrEqual(4);
  });

  test("replaced (non-continuation) text is shown whole without animation", () => {
    let s = receive(initialReveal("", 0), "第一版回答", 0);
    s = step(s, 16);
    s = receive(s, "完全不同的第二版", 32);
    expect(s.cut).toBe("完全不同的第二版".length);
  });
});

describe("snapCut keeps markdown from flashing as something else", () => {
  test("list marker is released together with its first word", () => {
    const text = "段落\n- 第一项";
    expect(text.slice(0, snapCut(text, 4))).toBe("段落\n- 第");
  });
  test("ordered list marker", () => {
    const text = "开头\n12. 第十二项";
    expect(text.slice(0, snapCut(text, 4))).toBe("开头\n12. 第");
  });
  test("heading marker", () => {
    const text = "## 标题";
    expect(text.slice(0, snapCut(text, 1))).toBe("## 标");
  });
  test("bold marker", () => {
    const text = "这是**重点**内容";
    expect(text.slice(0, snapCut(text, 3))).toBe("这是**重");
  });
  test("code fence with language", () => {
    const text = "```ts\nconst a = 1;\n```";
    expect(text.slice(0, snapCut(text, 2))).toBe("```ts");
  });
  test("plain text is cut exactly", () => {
    expect(snapCut("普通的文字", 3)).toBe(3);
  });
  test("never splits a surrogate pair", () => {
    const text = "好的😀再见";
    expect(snapCut(text, 3)).toBe(4);
  });
  test("bounded look-ahead", () => {
    const text = `${"-".repeat(100)}文字`;
    expect(snapCut(text, 1)).toBeLessThanOrEqual(26);
  });
});
