import { randomUUID } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  CHAT_FILES_MARKER,
  type ChatFileKind,
  type ChatFileView,
  chatFileUrl,
  IMAGE_ASPECTS,
  IMAGE_PROVIDER_PRESETS,
  type ImageAspect,
  type ImageProviderKind,
  type ImageSettingsView,
  isInlineSafeMime,
  MAX_CHAT_FILE_BYTES,
} from "../../../shared/chat-files";
import type { StoredAttachment } from "../channels/attachment-parts";
import type { AuditInitiator } from "../audit";
import type { AppVariables } from "../auth/guards";
import { decryptSecret, encryptSecret } from "../credentials";
import type { Database } from "../db/client";
import { type GrantedTool, REFUSAL_MARKER } from "../plugins/tools";
import { assertPublicUrl } from "../web/tools";
import { ImageProviderError, type ImageProviderConfig, probeImageModel, runImageModel } from "./image-provider";

/**
 * 聊天文件 + 图片生成（DESIGN.md §56，docs/chat-files.md）。
 *
 * 表（开机建，回滚安全）：
 * - chisabot_chat_files：用户上传的、机器人生成 / 修改的图片、机器人交给用户的工作区文件。字节在库里，
 *   按人隔离（owner_user_id），网址 /api/chat-files/<id> 只有本人能取；同时尽量写一份进机器人工作区。
 * - chisabot_image_settings：管理员选的图片模型（一行）。密钥 AES-GCM 加密；没填密钥时 MiniMax 可沿用
 *   部署环境变量（MINIMAX_API_KEY，或 OPENAI_BASE_URL 指向 minimax 时的 OPENAI_API_KEY）。
 *
 * 工具：image_generate / image_edit（只在图片设置打开且完整时给）、file_share、chat_files_recent。
 * 结果最后一行 `⟦chisabot:files⟧[…]` 给网页画卡；模型读到的是前面那句人话。
 */

type FileRow = {
  id: string;
  owner_user_id: string;
  agent_id: string;
  kind: ChatFileKind;
  name: string;
  mime_type: string;
  size_bytes: number;
  bytes?: Uint8Array;
  workspace_path: string | null;
  prompt: string | null;
  model: string | null;
  source_id: string | null;
  created_at: Date | string;
};

type SettingsRow = {
  enabled: boolean;
  provider: ImageProviderKind;
  base_url: string;
  model: string;
  edit_model: string;
  api_key: string | null;
  key_hint: string;
  updated_at: Date | string | null;
};

export type ChatFilesWorkspace = {
  /** 把字节写进机器人工作区；返回是否写成。 */
  write: (owner: string, agentId: string, path: string, bytes: Buffer) => Promise<boolean>;
  /** 从机器人工作区读一个文件的字节；文件不在时抛错（错误信息给机器人看）。 */
  read: (owner: string, agentId: string, path: string) => Promise<{ bytes: Buffer; name: string }>;
};

export class ChatFilesError extends Error {}

const LIST_COLUMNS = "id, owner_user_id, agent_id, kind, name, mime_type, size_bytes, workspace_path, prompt, model, source_id, created_at";
const iso = (value: Date | string) => new Date(value).toISOString();

export function fileView(row: FileRow): ChatFileView {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    size: Number(row.size_bytes),
    kind: row.kind,
    url: chatFileUrl(row.id),
    workspacePath: row.workspace_path,
    ...(row.prompt ? { prompt: row.prompt } : {}),
    createdAt: iso(row.created_at),
  };
}

/** 只认真的位图（SVG 能带脚本，不当图片）。 */
export function sniffImage(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}

const EXT_MIME: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  log: "text/plain",
  html: "text/html",
  htm: "text/html",
  svg: "image/svg+xml",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
};

/** 按字节判断；只有位图和 PDF 是看字节认的，其他按扩展名给个描述性类型（下载时一律当附件）。 */
export function detectMime(bytes: Uint8Array, name: string): string {
  const image = sniffImage(bytes);
  if (image) return image;
  if (bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-") return "application/pdf";
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return EXT_MIME[ext] ?? "application/octet-stream";
}

/** 文件名：去掉目录、控制字符和路径符号，最长 120。 */
export function safeName(raw: string, fallback = "文件"): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

const EXT_FOR_MIME: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

function slugOf(prompt: string) {
  const ascii = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return ascii || "image";
}

function stamp(now = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);

export function createChatFiles(
  database: Database,
  options: {
    encryptionKey: string;
    fetch?: typeof fetch;
    ownsBot: (owner: string, agentId: string) => Promise<boolean>;
    workspace?: ChatFilesWorkspace;
    env?: Record<string, string | undefined>;
    /** 网址结果的下载；默认只许公网地址、最大 20MB。测试里换掉。 */
    download?: (url: string) => Promise<Buffer>;
  },
) {
  const sql = database.$client;
  const doFetch = options.fetch ?? fetch;
  const env = options.env ?? process.env;

  async function defaultDownload(url: string): Promise<Buffer> {
    const checked = await assertPublicUrl(url);
    const response = await doFetch(checked, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new ImageProviderError(`取图片失败（HTTP ${response.status}）。`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_CHAT_FILE_BYTES) throw new ImageProviderError("图片太大。");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_CHAT_FILE_BYTES) throw new ImageProviderError("图片太大。");
    return bytes;
  }
  const download = options.download ?? defaultDownload;

  async function ensure() {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS chisabot_chat_files (
        id text PRIMARY KEY,
        owner_user_id text NOT NULL,
        agent_id text NOT NULL,
        kind text NOT NULL,
        name text NOT NULL,
        mime_type text NOT NULL,
        size_bytes integer NOT NULL,
        bytes bytea NOT NULL,
        workspace_path text,
        prompt text,
        model text,
        source_id text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS chisabot_chat_files_owner ON chisabot_chat_files (owner_user_id, agent_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS chisabot_image_settings (
        id text PRIMARY KEY DEFAULT 'default',
        enabled boolean NOT NULL DEFAULT false,
        provider text NOT NULL DEFAULT 'minimax',
        base_url text NOT NULL DEFAULT '',
        model text NOT NULL DEFAULT '',
        edit_model text NOT NULL DEFAULT '',
        api_key text,
        key_hint text NOT NULL DEFAULT '',
        updated_at timestamptz,
        updated_by text
      );
    `);
  }

  // ------------------------------------------------------------------ 图片模型设置

  async function settingsRow(): Promise<SettingsRow | null> {
    const rows = await sql.unsafe<SettingsRow[]>("SELECT * FROM chisabot_image_settings WHERE id = 'default'");
    return rows[0] ?? null;
  }

  function envKey(provider: ImageProviderKind): string {
    if (provider === "minimax") {
      if (env.MINIMAX_API_KEY?.trim()) return env.MINIMAX_API_KEY.trim();
      if (/minimax/i.test(env.OPENAI_BASE_URL ?? "") && env.OPENAI_API_KEY?.trim()) return env.OPENAI_API_KEY.trim();
      return "";
    }
    return env.IMAGE_API_KEY?.trim() ?? "";
  }

  async function settingsView(): Promise<ImageSettingsView> {
    const row = await settingsRow();
    const provider = (row?.provider ?? "minimax") as ImageProviderKind;
    const preset = IMAGE_PROVIDER_PRESETS[provider] ?? IMAGE_PROVIDER_PRESETS.minimax;
    const fromEnv = envKey(provider);
    const keySource = row?.api_key ? "saved" : fromEnv ? "environment" : "none";
    const baseUrl = row?.base_url || preset.baseUrl;
    const model = row?.model || preset.model;
    return {
      enabled: Boolean(row?.enabled),
      provider,
      baseUrl,
      model,
      editModel: row?.edit_model ?? "",
      keySource,
      keyHint: row?.api_key ? row.key_hint : fromEnv.length >= 8 ? fromEnv.slice(-4) : "",
      ready: Boolean(row?.enabled) && keySource !== "none" && Boolean(baseUrl) && Boolean(model),
      updatedAt: row?.updated_at ? iso(row.updated_at) : null,
    };
  }

  async function providerConfig(override?: Partial<ImageProviderConfig>): Promise<ImageProviderConfig | null> {
    const row = await settingsRow();
    const view = await settingsView();
    const provider = override?.provider ?? view.provider;
    const apiKey =
      override?.apiKey ||
      (row?.api_key && (!override?.provider || override.provider === view.provider) ? await decryptSecret(options.encryptionKey, row.api_key) : "") ||
      envKey(provider);
    if (!apiKey) return null;
    return {
      provider,
      baseUrl: override?.baseUrl || view.baseUrl || IMAGE_PROVIDER_PRESETS[provider].baseUrl,
      model: override?.model || view.model || IMAGE_PROVIDER_PRESETS[provider].model,
      editModel: override?.editModel ?? view.editModel,
      apiKey,
    };
  }

  const settingsInput = z
    .object({
      enabled: z.boolean(),
      provider: z.enum(["minimax", "openai"]),
      baseUrl: z.string().trim().max(300).url("接口地址要写成 https://… 这样的网址"),
      model: z.string().trim().min(1, "要填模型名").max(120),
      editModel: z.string().trim().max(120).optional().default(""),
      /** 不传 = 保留已存的；空字符串 = 清掉已存的（改用环境变量）。 */
      apiKey: z.string().max(4000).optional(),
    })
    .strict();

  async function saveSettings(actorId: string, raw: unknown): Promise<ImageSettingsView> {
    const input = settingsInput.parse(raw);
    const row = await settingsRow();
    let sealed = row?.api_key ?? null;
    let hint = row?.key_hint ?? "";
    if (input.apiKey !== undefined) {
      const key = input.apiKey.trim();
      sealed = key ? await encryptSecret(options.encryptionKey, key) : null;
      hint = key.length >= 8 ? key.slice(-4) : "";
    }
    await sql.unsafe(
      `INSERT INTO chisabot_image_settings (id, enabled, provider, base_url, model, edit_model, api_key, key_hint, updated_at, updated_by)
       VALUES ('default', $1, $2, $3, $4, $5, $6, $7, now(), $8)
       ON CONFLICT (id) DO UPDATE SET enabled = $1, provider = $2, base_url = $3, model = $4, edit_model = $5, api_key = $6, key_hint = $7, updated_at = now(), updated_by = $8`,
      [input.enabled, input.provider, input.baseUrl, input.model, input.editModel ?? "", sealed, hint, actorId],
    );
    return settingsView();
  }

  async function testSettings(raw: unknown): Promise<{ ok: boolean; message: string }> {
    const input = settingsInput.partial().parse(raw ?? {});
    const config = await providerConfig({
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.apiKey?.trim() ? { apiKey: input.apiKey.trim() } : {}),
    });
    if (!config) return { ok: false, message: "没有密钥：填一个密钥，或者在部署环境变量里配置。" };
    return probeImageModel(config, doFetch);
  }

  // ------------------------------------------------------------------ 文件

  async function store(
    owner: string,
    agentId: string,
    input: { kind: ChatFileKind; name: string; mimeType: string; bytes: Buffer; workspacePath?: string | null; prompt?: string | null; model?: string | null; sourceId?: string | null },
  ): Promise<ChatFileView> {
    const id = randomUUID();
    const rows = await sql.unsafe<FileRow[]>(
      `INSERT INTO chisabot_chat_files (id, owner_user_id, agent_id, kind, name, mime_type, size_bytes, bytes, workspace_path, prompt, model, source_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING ${LIST_COLUMNS}`,
      [id, owner, agentId, input.kind, input.name, input.mimeType, input.bytes.length, input.bytes, input.workspacePath ?? null, input.prompt ?? null, input.model ?? null, input.sourceId ?? null],
    );
    return fileView(rows[0]!);
  }

  async function setWorkspacePath(id: string, path: string | null) {
    await sql.unsafe("UPDATE chisabot_chat_files SET workspace_path = $2 WHERE id = $1", [id, path]);
  }

  async function row(owner: string, id: string, withBytes = false): Promise<FileRow | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const rows = await sql.unsafe<FileRow[]>(
      `SELECT ${LIST_COLUMNS}${withBytes ? ", bytes" : ""} FROM chisabot_chat_files WHERE id = $1 AND owner_user_id = $2`,
      [id, owner],
    );
    return rows[0] ?? null;
  }

  async function list(owner: string, agentId?: string, opts: { imagesOnly?: boolean; limit?: number } = {}): Promise<ChatFileView[]> {
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
    const rows = await sql.unsafe<FileRow[]>(
      `SELECT ${LIST_COLUMNS} FROM chisabot_chat_files WHERE owner_user_id = $1 ${agentId ? "AND agent_id = $2" : "AND $2::text IS NULL"}
       ${opts.imagesOnly ? "AND mime_type LIKE 'image/%' AND mime_type <> 'image/svg+xml'" : ""} ORDER BY created_at DESC LIMIT ${limit}`,
      [owner, agentId ?? null],
    );
    return rows.map(fileView);
  }

  async function remove(owner: string, id: string): Promise<boolean> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
    const rows = await sql.unsafe<{ id: string }[]>("DELETE FROM chisabot_chat_files WHERE id = $1 AND owner_user_id = $2 RETURNING id", [id, owner]);
    return rows.length > 0;
  }

  /** 工作区里一个不和自己已有记录撞名的路径。 */
  async function freePath(owner: string, agentId: string, folder: string, name: string): Promise<string> {
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let n = 1; n < 50; n += 1) {
      const candidate = `${folder}/${n === 1 ? name : `${stem}-${n}${ext}`}`;
      const taken = await sql.unsafe<{ id: string }[]>(
        "SELECT id FROM chisabot_chat_files WHERE owner_user_id = $1 AND agent_id = $2 AND workspace_path = $3 LIMIT 1",
        [owner, agentId, candidate],
      );
      if (taken.length === 0) return candidate;
    }
    return `${folder}/${stem}-${randomUUID().slice(0, 6)}${ext}`;
  }

  async function intoWorkspace(owner: string, agentId: string, folder: string, name: string, bytes: Buffer): Promise<string | null> {
    if (!options.workspace) return null;
    try {
      const path = await freePath(owner, agentId, folder, name);
      return (await options.workspace.write(owner, agentId, path, bytes)) ? path : null;
    } catch (error) {
      console.error(JSON.stringify({ type: "chat-files-workspace-write-failed", error: error instanceof Error ? error.name : "UnknownError", agentId }));
      return null;
    }
  }

  async function upload(owner: string, agentId: string, file: { name: string; bytes: Buffer }): Promise<ChatFileView> {
    if (!(await options.ownsBot(owner, agentId))) throw new ChatFilesError("找不到这个机器人。");
    if (file.bytes.length === 0) throw new ChatFilesError("文件是空的。");
    if (file.bytes.length > MAX_CHAT_FILE_BYTES) throw new ChatFilesError(`文件超过 ${formatSize(MAX_CHAT_FILE_BYTES)}。`);
    const name = safeName(file.name);
    const mimeType = detectMime(file.bytes, name);
    const workspacePath = await intoWorkspace(owner, agentId, "uploads", name, file.bytes);
    return store(owner, agentId, { kind: "upload", name, mimeType, bytes: file.bytes, workspacePath });
  }

  /**
   * 模型读一个聊天文件（attachment-parts 的 `cf:` 引用）：图片给字节；小的文本给文字；
   * 其他（PDF、Office、压缩包…）给一句说明，告诉机器人文件在工作区哪里、可以怎么处理。
   */
  async function loadForTurn(owner: string, id: string): Promise<StoredAttachment | null> {
    const found = await row(owner, id, true);
    if (!found?.bytes) return null;
    const bytes = Buffer.from(found.bytes);
    if (sniffImage(bytes)) return { mimeType: found.mime_type, name: found.name, bytes };
    const where = found.workspace_path ? `已保存在你的工作区 ${found.workspace_path}` : "没能写进你的工作区";
    if (TEXT_TYPES.has(found.mime_type) && bytes.length <= 512 * 1024) {
      return { mimeType: "text/plain", name: found.name, bytes: Buffer.concat([Buffer.from(`（${where}）\n\n`), bytes]) };
    }
    const hint =
      found.mime_type === "application/pdf"
        ? "要读内容用 computer_run_command：有 pdftotext 就用它，没有就用 strings / cat 看文字流。"
        : "要读内容用 computer_run_command 里合适的命令处理（unzip、strings 等）。";
    return {
      mimeType: "text/plain",
      name: found.name,
      bytes: Buffer.from(`用户上传了文件「${found.name}」（${found.mime_type}，${formatSize(bytes.length)}），${where}。${found.workspace_path ? hint : ""}文件 id：${found.id}`),
    };
  }

  // ------------------------------------------------------------------ 图片

  async function sourceImage(owner: string, agentId: string, source: string | undefined): Promise<{ bytes: Buffer; mimeType: string; name: string; id: string | null }> {
    const ref = source?.trim() ?? "";
    const id = ref.replace(/^.*\/api\/chat-files\//, "").replace(/[?#].*$/, "");
    if (/^[0-9a-f-]{36}$/i.test(id)) {
      const found = await row(owner, id, true);
      if (!found?.bytes) throw new ChatFilesError("找不到这张图片（文件 id 不对，或者已经删了）。");
      const bytes = Buffer.from(found.bytes);
      const mimeType = sniffImage(bytes);
      if (!mimeType) throw new ChatFilesError(`「${found.name}」不是 PNG / JPEG / GIF / WebP 图片。`);
      return { bytes, mimeType, name: found.name, id: found.id };
    }
    if (ref) {
      if (!options.workspace) throw new ChatFilesError("这个部署没有工作区；请用文件 id 指定图片。");
      const file = await options.workspace.read(owner, agentId, ref);
      const mimeType = sniffImage(file.bytes);
      if (!mimeType) throw new ChatFilesError(`${ref} 不是 PNG / JPEG / GIF / WebP 图片。`);
      return { ...file, mimeType, id: null };
    }
    const [latest] = await list(owner, agentId, { imagesOnly: true, limit: 1 });
    if (!latest) throw new ChatFilesError("还没有可以修改的图片：请用户先上传一张，或先用 image_generate 生成。");
    return sourceImage(owner, agentId, latest.id);
  }

  async function makeImage(
    owner: string,
    agentId: string,
    input: { prompt: string; aspect: ImageAspect; edit?: boolean; source?: string },
    signal?: AbortSignal,
  ): Promise<ChatFileView> {
    const view = await settingsView();
    if (!view.ready) throw new ChatFilesError("图片生成没有打开：请管理员在 设置 → 图片生成 里选好模型并打开。");
    const config = await providerConfig();
    if (!config) throw new ChatFilesError("图片模型没有密钥：请管理员在 设置 → 图片生成 里填写。");
    const src = input.edit ? await sourceImage(owner, agentId, input.source) : null;
    const result = await runImageModel(
      config,
      { prompt: input.prompt, aspect: input.aspect, ...(src ? { input: { bytes: src.bytes, mimeType: src.mimeType, name: src.name } } : {}) },
      { fetch: doFetch, download, ...(signal ? { signal } : {}) },
    );
    const mimeType = sniffImage(result.bytes);
    if (!mimeType) throw new ChatFilesError("图片模型返回的不是图片。");
    const name = `${stamp()}-${slugOf(input.prompt)}.${EXT_FOR_MIME[mimeType] ?? "png"}`;
    const workspacePath = await intoWorkspace(owner, agentId, "images", name, result.bytes);
    return store(owner, agentId, {
      kind: src ? "edited" : "generated",
      name,
      mimeType,
      bytes: result.bytes,
      workspacePath,
      prompt: input.prompt,
      model: src ? config.editModel || config.model : config.model,
      sourceId: src?.id ?? null,
    });
  }

  async function share(owner: string, agentId: string, path: string, title?: string): Promise<ChatFileView> {
    if (!options.workspace) throw new ChatFilesError("这个部署没有工作区。");
    const file = await options.workspace.read(owner, agentId, path);
    if (file.bytes.length > MAX_CHAT_FILE_BYTES) throw new ChatFilesError(`文件超过 ${formatSize(MAX_CHAT_FILE_BYTES)}，不能交给用户。`);
    const base = safeName(file.name || path.split("/").pop() || "文件");
    const ext = base.includes(".") ? base.slice(base.lastIndexOf(".")) : "";
    const name = title?.trim() ? safeName(title.trim().endsWith(ext) ? title.trim() : `${title.trim()}${ext}`) : base;
    return store(owner, agentId, { kind: "shared", name, mimeType: detectMime(file.bytes, base), bytes: file.bytes, workspacePath: path });
  }

  // ------------------------------------------------------------------ 机器人

  const withFiles = (text: string, files: ChatFileView[]) =>
    `${text}\n${CHAT_FILES_MARKER}${JSON.stringify(files.map(({ prompt: _p, ...rest }) => rest))}`;

  function describe(file: ChatFileView) {
    return `文件 id：${file.id}；${file.workspacePath ? `工作区路径：${file.workspacePath}` : "没有写进工作区"}；${formatSize(file.size)}`;
  }

  async function tools(owner: string, agentId: string, initiator?: AuditInitiator): Promise<GrantedTool[]> {
    void initiator;
    const tool = <T extends z.ZodType>(name: string, description: string, parameters: T, run: (input: z.infer<T>) => Promise<string>): GrantedTool => ({
      name,
      ref: `chat-files/${name}`,
      description,
      parameters,
      async execute(args) {
        const parsed = parameters.safeParse(args);
        if (!parsed.success) return `${REFUSAL_MARKER} ${name} 参数不对：${parsed.error.issues[0]?.message ?? ""}`;
        try {
          return await run(parsed.data);
        } catch (error) {
          if (error instanceof ChatFilesError || error instanceof ImageProviderError) return `${REFUSAL_MARKER} ${error.message}`;
          if (error instanceof Error && /file|path|workspace|There is no|文件/i.test(error.message)) return `${REFUSAL_MARKER} ${error.message}`;
          throw error;
        }
      },
    });
    const out: GrantedTool[] = [];
    const images = await settingsView().catch(() => null);
    if (images?.ready) {
      const aspect = z.enum(IMAGE_ASPECTS).optional().describe("画幅，默认 1:1");
      out.push(
        tool(
          "image_generate",
          "按文字描述生成一张图片。图片会自动显示在聊天里（可以点开看大图、下载），同时存进你的工作区 images/。不要再用 Markdown 贴图或贴链接。提示词写清主体、风格、构图。",
          z.object({ prompt: z.string().min(1).max(2000).describe("图片描述（中英文都可以）"), aspect_ratio: aspect }).strict(),
          async (input) => {
            const file = await makeImage(owner, agentId, { prompt: input.prompt, aspect: input.aspect_ratio ?? "1:1" });
            return withFiles(`已生成 1 张图片，已经显示在聊天里，用户可以点开看大图、下载。不要再贴这张图或它的链接。${describe(file)}`, [file]);
          },
        ),
        tool(
          "image_edit",
          `按要求修改一张已有的图片（用户上传的、你生成的，或工作区里的图片），结果显示在聊天里并存进工作区 images/。不写 source 就改这个聊天里最近的一张图片。${images.provider === "minimax" ? IMAGE_PROVIDER_PRESETS.minimax.editNote : ""}`,
          z
            .object({
              prompt: z.string().min(1).max(2000).describe("怎么改，或者修改后的样子"),
              source: z.string().max(400).optional().describe("要改的图片：文件 id、/api/chat-files/… 网址，或工作区路径（如 uploads/a.png）；不写 = 最近一张"),
              aspect_ratio: aspect,
            })
            .strict(),
          async (input) => {
            const file = await makeImage(owner, agentId, { prompt: input.prompt, aspect: input.aspect_ratio ?? "1:1", edit: true, ...(input.source ? { source: input.source } : {}) });
            return withFiles(`已改好，新图片已经显示在聊天里。不要再贴这张图或它的链接。${describe(file)}`, [file]);
          },
        ),
      );
    }
    if (options.workspace) {
      out.push(
        tool(
          "file_share",
          "把你工作区里的一个文件交给用户：聊天里会出现一张可以下载的文件卡（图片和 PDF 能预览）。做好报告、表格、压缩包、图片等要给用户时用它，不要贴工作区路径或 workspace.local 链接让用户自己找。",
          z.object({ path: z.string().min(1).max(400).describe("工作区里的相对路径，如 report.pdf"), title: z.string().max(80).optional().describe("给用户看的文件名（可选）") }).strict(),
          async (input) => {
            const file = await share(owner, agentId, input.path.trim(), input.title);
            return withFiles(`已把「${file.name}」交给用户（聊天里有下载卡片）。不要再贴路径或链接。${describe(file)}`, [file]);
          },
        ),
      );
    }
    out.push(
      tool(
        "chat_files_recent",
        "列出这个聊天里最近的文件：用户上传的、你生成的图片、你交给用户的文件（文件 id、工作区路径）。",
        z.object({ images_only: z.boolean().optional(), limit: z.number().int().min(1).max(30).optional() }).strict(),
        async (input) => {
          const files = await list(owner, agentId, { imagesOnly: input.images_only === true, limit: input.limit ?? 10 });
          if (files.length === 0) return "还没有文件。";
          const label = { upload: "用户上传", generated: "你生成", edited: "你修改", shared: "你交给用户" } as const;
          return files.map((f) => `- ${f.name}（${label[f.kind]}，${f.mimeType}，${formatSize(f.size)}）id ${f.id}${f.workspacePath ? `，工作区 ${f.workspacePath}` : ""}`).join("\n");
        },
      ),
    );
    return out;
  }

  /** 每轮开头给机器人的用法（不点名具体文件）。 */
  async function guidance(): Promise<string> {
    const images = await settingsView().catch(() => null);
    return [
      "【文件】用户在聊天里上传的文件会存进你的工作区 uploads/（消息里能看到图片和说明）。",
      options.workspace ? "要把工作区里的文件给用户，用 file_share（聊天里出下载卡片），不要贴路径或 workspace.local 链接。" : "",
      images?.ready
        ? "要画图用 image_generate，要改图（包括用户刚上传的）用 image_edit；结果会自动显示，不要再用 Markdown 贴图。"
        : "这个部署还没打开图片生成：用户要你画图时，告诉他请管理员在 设置 → 图片生成 里打开。",
    ]
      .filter(Boolean)
      .join("");
  }

  // ------------------------------------------------------------------ 路由

  function routes(requireUser: MiddlewareHandler<{ Variables: AppVariables }>) {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("*", requireUser);
    app.onError((error, c) => {
      if (error instanceof ChatFilesError) return c.json({ error: error.message }, 400);
      if (error instanceof z.ZodError) return c.json({ error: error.issues[0]?.message ?? "参数不对。" }, 400);
      console.error(JSON.stringify({ type: "chat-files-error", error: error.name, route: c.req.path }));
      return c.json({ error: "文件服务暂时不可用，请重试。" }, 503);
    });
    const admin: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
      if (c.var.actor.role !== "admin") return c.json({ error: "只有管理员能改图片模型。" }, 403);
      await next();
    };
    app.get("/settings/image", admin, async (c) => c.json({ settings: await settingsView() }));
    app.put("/settings/image", admin, bodyLimit({ maxSize: 16_384 }), async (c) => c.json({ settings: await saveSettings(c.var.actor.id, await c.req.json()) }));
    app.post("/settings/image/test", admin, bodyLimit({ maxSize: 16_384 }), async (c) => c.json(await testSettings(await c.req.json().catch(() => ({})))));
    app.get("/", async (c) => {
      const agentId = c.req.query("agentId") || undefined;
      return c.json({ files: await list(c.var.actor.id, agentId, { imagesOnly: c.req.query("images") === "1", limit: Number(c.req.query("limit") ?? 30) || 30 }) });
    });
    app.post(
      "/",
      bodyLimit({ maxSize: MAX_CHAT_FILE_BYTES + 512 * 1024, onError: (c) => c.json({ error: `文件超过 ${formatSize(MAX_CHAT_FILE_BYTES)}。` }, 413) }),
      async (c) => {
        const form = await c.req.formData().catch(() => null);
        const file = form?.get("file");
        const agentId = String(form?.get("agentId") ?? "");
        if (!(file instanceof File)) throw new ChatFilesError("没有收到文件。");
        if (!agentId) throw new ChatFilesError("缺少机器人。");
        const saved = await upload(c.var.actor.id, agentId, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
        return c.json({ file: saved }, 201);
      },
    );
    app.get("/:id", async (c) => {
      const found = await row(c.var.actor.id, c.req.param("id"), true);
      if (!found?.bytes) return c.json({ error: "找不到这个文件。" }, 404);
      const inline = isInlineSafeMime(found.mime_type) && c.req.query("download") !== "1";
      const encoded = encodeURIComponent(found.name);
      const headers: Record<string, string> = {
        "content-type": inline ? found.mime_type : "application/octet-stream",
        "content-length": String(found.size_bytes),
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encoded}`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=31536000, immutable",
      };
      // PDF 要浏览器自带的阅读器，沙箱 CSP 会把它挡掉；图片和附件都加沙箱。
      if (found.mime_type !== "application/pdf" || !inline) headers["content-security-policy"] = "sandbox; default-src 'none'";
      return new Response(c.req.method === "HEAD" ? null : new Uint8Array(found.bytes), { headers });
    });
    app.delete("/:id", async (c) => ((await remove(c.var.actor.id, c.req.param("id"))) ? c.body(null, 204) : c.json({ error: "找不到这个文件。" }, 404)));
    return app;
  }

  return { ensure, settingsView, saveSettings, testSettings, providerConfig, store, setWorkspacePath, row, list, remove, upload, loadForTurn, makeImage, share, tools, guidance, routes };
}
export type ChatFiles = ReturnType<typeof createChatFiles>;
