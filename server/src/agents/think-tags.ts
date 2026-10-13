/**
 * 正文里的 <think>…</think> 当作思考，不当作回答。
 *
 * 有些模型（MiniMax、DeepSeek-R1 系、部分 OpenAI 兼容网关后面的开源模型）不走 reasoning 字段，
 * 而是把推理直接写进正文，用 <think> 标签包起来。AI SDK 的 OpenAI chat 客户端不认这个，于是一大段
 * 英文推理会原样进回复气泡、进历史、进复制。这里在模型这一层把标签里的内容改成 reasoning 流片段，
 * 后面的 AG-UI 就把它当 REASONING_* 事件发，界面放进可折叠的「思考」里（DESIGN.md §44）。
 *
 * 只认成对的 <think>/<thinking> 标签（大小写不敏感）；标签可以被拆在任意两个流片段之间。
 * 没有标签的模型输出原样透传，一个字不改。
 */

const OPEN = /<(think|thinking)>/i;
const MAX_TAG = "</thinking>".length;

type Part = { type: string; id?: string; delta?: string; [key: string]: unknown };
export type ThinkPiece = { kind: "text" | "reasoning"; text: string };

/** 有状态的切分器：喂正文片段，吐出 text / reasoning 片段。 */
export class ThinkSplitter {
  private inThink = false;
  private closeTag = "";
  private pending = "";

  push(chunk: string): ThinkPiece[] {
    this.pending += chunk;
    const out: ThinkPiece[] = [];
    for (;;) {
      if (!this.inThink) {
        const m = OPEN.exec(this.pending);
        if (m) {
          if (m.index > 0) out.push({ kind: "text", text: this.pending.slice(0, m.index) });
          this.pending = this.pending.slice(m.index + m[0].length);
          this.inThink = true;
          this.closeTag = `</${m[1].toLowerCase()}>`;
          continue;
        }
        const keep = partialTagTail(this.pending, ["<think>", "<thinking>"]);
        const emit = this.pending.slice(0, this.pending.length - keep);
        if (emit) out.push({ kind: "text", text: emit });
        this.pending = this.pending.slice(this.pending.length - keep);
        return out;
      }
      const at = this.pending.toLowerCase().indexOf(this.closeTag);
      if (at >= 0) {
        if (at > 0) out.push({ kind: "reasoning", text: this.pending.slice(0, at) });
        this.pending = this.pending.slice(at + this.closeTag.length).replace(/^\s+/, "");
        this.inThink = false;
        continue;
      }
      const keep = partialTagTail(this.pending, [this.closeTag]);
      const emit = this.pending.slice(0, this.pending.length - keep);
      if (emit) out.push({ kind: "reasoning", text: emit });
      this.pending = this.pending.slice(this.pending.length - keep);
      return out;
    }
  }

  /** 流结束：剩下的半截标签按当前状态吐出去（没闭合的 <think> 里的内容仍算思考）。 */
  flush(): ThinkPiece[] {
    const rest = this.pending;
    this.pending = "";
    return rest ? [{ kind: this.inThink ? "reasoning" : "text", text: rest }] : [];
  }
}

/** pending 结尾有多少字符可能是某个标签的开头（要等下一个片段才能确定）。 */
function partialTagTail(text: string, tags: string[]): number {
  const lower = text.slice(-MAX_TAG).toLowerCase();
  for (let n = Math.min(lower.length, MAX_TAG - 1); n > 0; n--) {
    const tail = lower.slice(lower.length - n);
    if (tags.some((tag) => tag.startsWith(tail) && tail.length < tag.length)) return n;
  }
  return 0;
}

/** 整段文本（非流式）拆开。 */
export function splitThinkTags(text: string): ThinkPiece[] {
  const s = new ThinkSplitter();
  return merge([...s.push(text), ...s.flush()]);
}

function merge(pieces: ThinkPiece[]): ThinkPiece[] {
  const out: ThinkPiece[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last && last.kind === p.kind) last.text += p.text;
    else out.push({ ...p });
  }
  return out;
}

/** 把模型流里 text-* 片段中的 <think> 段改写成 reasoning-* 片段。 */
export function thinkTagTransform(): TransformStream<Part, Part> {
  const splitters = new Map<string, ThinkSplitter>();
  const reasoningOpen = new Map<string, string>(); // text id -> reasoning id
  const textOpen = new Set<string>();
  let seq = 0;
  const emit = (controller: TransformStreamDefaultController<Part>, id: string, pieces: ThinkPiece[]) => {
    for (const p of pieces) {
      if (!p.text) continue;
      if (p.kind === "reasoning") {
        if (textOpen.has(id)) {
          controller.enqueue({ type: "text-end", id });
          textOpen.delete(id);
        }
        let rid = reasoningOpen.get(id);
        if (!rid) {
          rid = `${id}-think-${++seq}`;
          reasoningOpen.set(id, rid);
          controller.enqueue({ type: "reasoning-start", id: rid });
        }
        controller.enqueue({ type: "reasoning-delta", id: rid, delta: p.text });
      } else {
        const rid = reasoningOpen.get(id);
        if (rid) {
          controller.enqueue({ type: "reasoning-end", id: rid });
          reasoningOpen.delete(id);
        }
        if (!textOpen.has(id)) {
          controller.enqueue({ type: "text-start", id });
          textOpen.add(id);
        }
        controller.enqueue({ type: "text-delta", id, delta: p.text });
      }
    }
  };
  return new TransformStream<Part, Part>({
    transform(part, controller) {
      const id = typeof part.id === "string" ? part.id : "";
      if (part.type === "text-start") {
        splitters.set(id, new ThinkSplitter());
        return; // 有了第一段正文再开（开头若全是 <think>，就不留一个空的文字气泡）
      }
      if (part.type === "text-delta" && splitters.has(id)) {
        emit(controller, id, splitters.get(id)!.push(String(part.delta ?? "")));
        return;
      }
      if (part.type === "text-end" && splitters.has(id)) {
        emit(controller, id, splitters.get(id)!.flush());
        splitters.delete(id);
        const rid = reasoningOpen.get(id);
        if (rid) {
          controller.enqueue({ type: "reasoning-end", id: rid });
          reasoningOpen.delete(id);
        }
        if (textOpen.has(id)) {
          controller.enqueue(part);
          textOpen.delete(id);
        }
        return;
      }
      controller.enqueue(part);
    },
    flush(controller) {
      for (const [id, s] of splitters) emit(controller, id, s.flush());
      for (const rid of reasoningOpen.values()) controller.enqueue({ type: "reasoning-end", id: rid });
      for (const id of textOpen) controller.enqueue({ type: "text-end", id });
    },
  });
}

/** 包一层：doStream 的流过 thinkTagTransform，doGenerate 的 text 内容拆开。其余原样。 */
export function thinkTagLanguageModel<T>(model: T): T {
  if (!model || typeof model !== "object") return model;
  const target = model as unknown as Record<string, unknown>;
  return new Proxy(model as unknown as object, {
    get(object, property) {
      if (property === "doStream" && typeof target.doStream === "function") {
        const method = target.doStream as (o: unknown) => Promise<{ stream: ReadableStream<Part> }>;
        return async (options: unknown) => {
          const result = await method.call(object, options);
          return { ...result, stream: result.stream.pipeThrough(thinkTagTransform()) };
        };
      }
      if (property === "doGenerate" && typeof target.doGenerate === "function") {
        const method = target.doGenerate as (o: unknown) => Promise<{ content?: Part[] }>;
        return async (options: unknown) => {
          const result = await method.call(object, options);
          if (!Array.isArray(result.content)) return result;
          const content: Part[] = [];
          for (const c of result.content) {
            if (c.type !== "text" || typeof c.text !== "string" || !OPEN.test(c.text)) {
              content.push(c);
              continue;
            }
            for (const p of splitThinkTags(c.text)) {
              if (p.kind === "text" && !p.text.trim()) continue;
              content.push(p.kind === "reasoning" ? { type: "reasoning", text: p.text } : { ...c, text: p.text });
            }
          }
          return { ...result, content };
        };
      }
      const value = Reflect.get(object, property);
      return typeof value === "function" ? value.bind(object) : value;
    },
  }) as unknown as T;
}
