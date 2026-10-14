import type { ImageAspect, ImageProviderKind } from "../../../shared/chat-files";

/**
 * 图片模型的两种接口（DESIGN.md §56）。
 *
 * - minimax：POST {base}/v1/image_generation（image-01）。修改 = subject_reference 参考图生成。
 * - openai：OpenAI 兼容 POST {base}/images/generations；修改 POST {base}/images/edits（multipart）。
 *   gpt-image、new-api / One API、grok2api 这类中转都是这个形状。
 *
 * 只返回字节：网址结果由调用方给的 `download` 取回（公网检查、大小上限在那里）。
 */
export type ImageProviderConfig = {
  provider: ImageProviderKind;
  baseUrl: string;
  model: string;
  editModel?: string;
  apiKey: string;
};

export type ImageInput = { bytes: Buffer; mimeType: string; name?: string };

export type ImageResult = { bytes: Buffer; revisedPrompt?: string };

export class ImageProviderError extends Error {}

const TIMEOUT_MS = 150_000;

function trimSlash(url: string) {
  return url.trim().replace(/\/+$/, "");
}

/** MiniMax 的根地址：去掉用户可能写上的 /v1。 */
export function minimaxEndpoint(baseUrl: string) {
  return `${trimSlash(baseUrl).replace(/\/v1$/i, "")}/v1/image_generation`;
}

/** OpenAI 兼容的根：没有路径就补 /v1，有路径（/v1、/api/v1 …）原样。 */
export function openaiBase(baseUrl: string) {
  const base = trimSlash(baseUrl);
  try {
    const url = new URL(base);
    return url.pathname === "/" || url.pathname === "" ? `${base}/v1` : base;
  } catch {
    return base;
  }
}

export function sizeForAspect(aspect: ImageAspect): string {
  if (aspect === "16:9" || aspect === "4:3") return "1536x1024";
  if (aspect === "9:16" || aspect === "3:4") return "1024x1536";
  return "1024x1024";
}

function short(text: string, n = 240) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ImageProviderError(`图片接口返回的不是 JSON（HTTP ${response.status}）：${short(text, 160)}`);
  }
}

function errorText(body: Record<string, unknown>): string {
  const error = body.error as { message?: unknown } | string | undefined;
  if (typeof error === "string") return error;
  if (error && typeof error.message === "string") return error.message;
  const base = body.base_resp as { status_msg?: unknown } | undefined;
  if (base && typeof base.status_msg === "string") return base.status_msg;
  if (typeof body.message === "string") return body.message;
  return "";
}

export async function runImageModel(
  config: ImageProviderConfig,
  request: { prompt: string; aspect: ImageAspect; input?: ImageInput },
  deps: { fetch: typeof fetch; download: (url: string) => Promise<Buffer>; signal?: AbortSignal },
): Promise<ImageResult> {
  const signal = deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);
  const auth = { authorization: `Bearer ${config.apiKey}` };
  const model = (request.input && config.editModel?.trim()) || config.model;

  if (config.provider === "minimax") {
    const body: Record<string, unknown> = {
      model,
      prompt: request.prompt,
      aspect_ratio: request.aspect,
      n: 1,
      response_format: "base64",
      prompt_optimizer: false,
    };
    if (request.input) {
      body.subject_reference = [
        { type: "character", image_file: `data:${request.input.mimeType};base64,${request.input.bytes.toString("base64")}` },
      ];
    }
    const response = await deps.fetch(minimaxEndpoint(config.baseUrl), {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const json = await readJson(response);
    const base = json.base_resp as { status_code?: number; status_msg?: string } | undefined;
    if (!response.ok || (base && base.status_code !== 0)) {
      throw new ImageProviderError(`图片模型出错（${base?.status_code ?? response.status}）：${short(errorText(json) || "未知错误")}`);
    }
    const data = json.data as { image_base64?: unknown; image_urls?: unknown } | undefined;
    const b64 = Array.isArray(data?.image_base64) ? data.image_base64[0] : undefined;
    if (typeof b64 === "string" && b64) return { bytes: Buffer.from(b64, "base64") };
    const url = Array.isArray(data?.image_urls) ? data.image_urls[0] : undefined;
    if (typeof url === "string" && url) return { bytes: await deps.download(url) };
    throw new ImageProviderError("图片模型没有返回图片（可能被内容审核拦下了）。");
  }

  const base = openaiBase(config.baseUrl);
  let response: Response;
  if (request.input) {
    const form = new FormData();
    form.set("model", model);
    form.set("prompt", request.prompt);
    form.set("n", "1");
    form.set("size", sizeForAspect(request.aspect));
    const ext = request.input.mimeType.split("/")[1] ?? "png";
    form.set("image", new Blob([new Uint8Array(request.input.bytes)], { type: request.input.mimeType }), request.input.name || `image.${ext}`);
    response = await deps.fetch(`${base}/images/edits`, { method: "POST", headers: auth, body: form, signal });
  } else {
    response = await deps.fetch(`${base}/images/generations`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: request.prompt, n: 1, size: sizeForAspect(request.aspect) }),
      signal,
    });
  }
  const json = await readJson(response);
  if (!response.ok) throw new ImageProviderError(`图片模型出错（HTTP ${response.status}）：${short(errorText(json) || "未知错误")}`);
  const first = Array.isArray(json.data) ? (json.data[0] as { b64_json?: unknown; url?: unknown; revised_prompt?: unknown } | undefined) : undefined;
  const revisedPrompt = typeof first?.revised_prompt === "string" ? first.revised_prompt : undefined;
  if (typeof first?.b64_json === "string" && first.b64_json) return { bytes: Buffer.from(first.b64_json, "base64"), ...(revisedPrompt ? { revisedPrompt } : {}) };
  if (typeof first?.url === "string" && first.url) {
    const url = first.url;
    const bytes = url.startsWith("data:") ? Buffer.from(url.slice(url.indexOf(",") + 1), "base64") : await deps.download(url);
    return { bytes, ...(revisedPrompt ? { revisedPrompt } : {}) };
  }
  throw new ImageProviderError("图片模型没有返回图片。");
}

/**
 * 不花钱地检查设置：MiniMax 发一个空提示词（鉴权通过会回「prompt are required」）；OpenAI 兼容读 /models。
 */
export async function probeImageModel(config: ImageProviderConfig, doFetch: typeof fetch): Promise<{ ok: boolean; message: string }> {
  const signal = AbortSignal.timeout(20_000);
  try {
    if (config.provider === "minimax") {
      const response = await doFetch(minimaxEndpoint(config.baseUrl), {
        method: "POST",
        headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: config.model, prompt: "", n: 1 }),
        signal,
      });
      const json = await readJson(response);
      const base = json.base_resp as { status_code?: number; status_msg?: string } | undefined;
      const msg = String(base?.status_msg ?? "");
      if (/prompt/i.test(msg) && !/model/i.test(msg)) return { ok: true, message: "密钥和模型可用（只做了检查，没有生成图片）。" };
      if (/unsupported model/i.test(msg)) return { ok: false, message: `模型名不对：${short(msg, 120)}` };
      return { ok: false, message: `检查没通过：${short(msg || `HTTP ${response.status}`, 160)}` };
    }
    const response = await doFetch(`${openaiBase(config.baseUrl)}/models`, { headers: { authorization: `Bearer ${config.apiKey}` }, signal });
    if (response.status === 401 || response.status === 403) return { ok: false, message: "密钥被拒绝（401/403）。" };
    if (!response.ok) return { ok: false, message: `接口返回 HTTP ${response.status}。` };
    const json = await readJson(response).catch(() => ({}) as Record<string, unknown>);
    const ids = Array.isArray(json.data) ? (json.data as { id?: unknown }[]).map((m) => String(m.id ?? "")) : [];
    if (ids.length && !ids.includes(config.model)) return { ok: true, message: `接口可用，但模型列表里没有 ${config.model}，生成时可能失败。` };
    return { ok: true, message: "接口和密钥可用（只读了模型列表，没有生成图片）。" };
  } catch (error) {
    if (error instanceof ImageProviderError) return { ok: false, message: error.message };
    return { ok: false, message: `连不上图片接口：${error instanceof Error ? short(error.message, 120) : "未知错误"}` };
  }
}
