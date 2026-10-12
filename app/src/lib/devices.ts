import { queryOptions } from "@tanstack/react-query";
import type {
  DeviceApprovalView,
  DeviceAuditEntry,
  DeviceCapabilities,
  DeviceView,
} from "../../../shared/devices";
import { client } from "@/lib/client";

/**
 * PC 设备（docs/pc-node.md）。列表每 5 秒刷新一次，这样在线状态和待审批几乎是实时的，
 * 不需要另开一条推送通道。
 */

export const deviceKeys = {
  all: ["devices"] as const,
  list: (all: boolean) => ["devices", "list", all] as const,
  detail: (id: string) => ["devices", "detail", id] as const,
  audit: (id: string) => ["devices", "audit", id] as const,
  download: ["devices", "download"] as const,
};

export type DeviceList = { devices: DeviceView[]; approvals: DeviceApprovalView[] };

export function deviceListQueryOptions(all = false) {
  return queryOptions({
    queryKey: deviceKeys.list(all),
    queryFn: ({ signal }): Promise<DeviceList> =>
      client(`/api/devices${all ? "?all=1" : ""}`, { fallback: "无法加载设备列表", signal }).then((r) => r.json()),
    refetchInterval: 5_000,
    refetchOnWindowFocus: "always",
  });
}

export function deviceQueryOptions(id: string) {
  return queryOptions({
    queryKey: deviceKeys.detail(id),
    queryFn: ({ signal }): Promise<DeviceView> =>
      client(`/api/devices/${encodeURIComponent(id)}`, "device", { fallback: "无法加载这台设备", signal }),
    refetchInterval: 5_000,
  });
}

export function deviceAuditQueryOptions(id: string) {
  return queryOptions({
    queryKey: deviceKeys.audit(id),
    queryFn: ({ signal }): Promise<DeviceAuditEntry[]> =>
      client(`/api/devices/${encodeURIComponent(id)}/audit?limit=100`, "entries", { fallback: "无法加载操作记录", signal }),
    refetchInterval: 8_000,
  });
}

export type DevicePatch = {
  name?: string;
  capabilities?: Partial<DeviceCapabilities>;
  allowedRoots?: string[];
  paused?: boolean;
  botIds?: string[];
};

export function patchDevice(id: string, patch: DevicePatch): Promise<DeviceView> {
  return client(`/api/devices/${encodeURIComponent(id)}`, "device", {
    method: "PATCH",
    body: patch,
    fallback: "保存失败，请重试",
  });
}

export async function revokeDevice(id: string) {
  await client(`/api/devices/${encodeURIComponent(id)}/revoke`, { method: "POST", fallback: "撤销失败，请重试" });
}

export async function deleteDevice(id: string) {
  await client(`/api/devices/${encodeURIComponent(id)}`, { method: "DELETE", fallback: "删除失败，请重试" });
}

export async function testDevice(id: string): Promise<Record<string, unknown>> {
  const response = await client(`/api/devices/${encodeURIComponent(id)}/test`, {
    method: "POST",
    fallback: "测试连接失败",
  });
  return (await response.json()).result ?? {};
}

export async function decideApproval(id: string, decision: "approve" | "deny") {
  await client(`/api/devices/approvals/${encodeURIComponent(id)}`, {
    method: "POST",
    body: { decision },
    fallback: "这个审批已经处理过或已过期",
  });
}

/** PC 客户端安装包清单（统一成这个形状，不管来源是哪一种）。都找不到时为 null。 */
export type PcDownload = {
  version: string;
  publishedAt?: string;
  /** 从哪里找到的，排查用。 */
  source?: string;
  files: Array<{ kind: "installer" | "portable"; name: string; url: string; bytes: number; sha256?: string }>;
};

/** 公开仓库：自建部署没有自己的下载目录时，回退到 GitHub Releases 的最新版本。 */
const GITHUB_REPO = "ChisaAlter/ChisaBot";

/*
 * 安装包可能放在几个地方，按顺序找，第一个找到的为准：
 *   1. 构建时配置的 VITE_CHISABOT_PC_FEED（latest.json 或 electron-updater 的 latest.yml 的地址）；
 *   2. 本服务器网关的 /downloads/pc/latest.json（登录后可下载）；
 *   3. PC 客户端自动更新用的 /downloads/chisabot-pc/（latest.json 或 latest.yml）；
 *   4. GitHub Releases 最新版本。
 * 以前只认第 2 个，而这台服务器的安装包发布在 /downloads/chisabot-pc/，于是「电脑操作 → 下载 PC 客户端」
 * 一直显示「安装包还没有发布到这台服务器」。
 */
function feedCandidates(): string[] {
  const configured = (import.meta.env.VITE_CHISABOT_PC_FEED as string | undefined)?.trim();
  return [
    ...(configured ? [configured] : []),
    "/downloads/pc/latest.json",
    "/downloads/chisabot-pc/latest.json",
    "/downloads/chisabot-pc/latest.yml",
  ];
}

function kindOf(name: string): "installer" | "portable" | null {
  if (/setup.*\.exe$/i.test(name) || /\.exe$/i.test(name)) return "installer";
  if (/portable.*\.zip$/i.test(name) || /\.zip$/i.test(name)) return "portable";
  return null;
}

function fromJson(body: unknown, source: string): PcDownload | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Partial<PcDownload>;
  if (typeof value.version !== "string" || !Array.isArray(value.files)) return null;
  const files = value.files.filter(
    (file) => file && typeof file.url === "string" && (file.kind === "installer" || file.kind === "portable"),
  );
  return files.length ? { ...value, version: value.version, files, source } as PcDownload : null;
}

/** electron-updater 的 latest.yml：只读需要的几行（version、files[].url/size），不引入 YAML 解析库。 */
export function parseLatestYml(text: string, feedUrl: string): PcDownload | null {
  const version = /^version:\s*['"]?([^'"\s]+)/m.exec(text)?.[1];
  if (!version) return null;
  const base = new URL(feedUrl, window.location.origin);
  const files: PcDownload["files"] = [];
  const re = /-\s+url:\s*['"]?([^'"\n]+?)['"]?\s*\n(?:\s+[a-z0-9]+:.*\n)*?\s+size:\s*(\d+)/gi;
  for (let match = re.exec(text); match; match = re.exec(text)) {
    const name = match[1]?.trim() ?? "";
    const kind = kindOf(name);
    if (!kind || files.some((file) => file.kind === kind)) continue;
    files.push({ kind, name, url: new URL(name, base).href, bytes: Number(match[2]) || 0 });
  }
  if (!files.length) {
    const path = /^path:\s*['"]?([^'"\n]+?)['"]?\s*$/m.exec(text)?.[1];
    if (path && kindOf(path)) files.push({ kind: kindOf(path)!, name: path, url: new URL(path, base).href, bytes: 0 });
  }
  const releaseDate = /^releaseDate:\s*['"]?([^'"\n]+)/m.exec(text)?.[1];
  return files.length ? { version, files, source: feedUrl, ...(releaseDate ? { publishedAt: releaseDate } : {}) } : null;
}

async function fromFeed(url: string): Promise<PcDownload | null> {
  try {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    // 网关没登录时会把请求转到登录页（HTML），那不是清单。
    if (type.includes("html")) return null;
    const text = await response.text();
    if (/\.ya?ml(\?|$)/i.test(url)) return parseLatestYml(text, url);
    return fromJson(JSON.parse(text), url);
  } catch {
    return null;
  }
}

async function fromGitHubRelease(): Promise<PcDownload | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return null;
    const release = (await response.json()) as {
      tag_name?: string;
      published_at?: string;
      assets?: Array<{ name: string; size: number; browser_download_url: string }>;
    };
    const files: PcDownload["files"] = [];
    for (const asset of release.assets ?? []) {
      if (!/^ChisaBot-PC-/i.test(asset.name)) continue;
      const kind = /\.exe$/i.test(asset.name) ? "installer" : /\.zip$/i.test(asset.name) ? "portable" : null;
      if (!kind || files.some((file) => file.kind === kind)) continue;
      files.push({ kind, name: asset.name, url: asset.browser_download_url, bytes: asset.size });
    }
    if (!files.length || !release.tag_name) return null;
    return {
      version: release.tag_name.replace(/^v/, ""),
      files,
      source: "GitHub Releases",
      ...(release.published_at ? { publishedAt: release.published_at } : {}),
    };
  } catch {
    return null;
  }
}

export async function findPcDownload(): Promise<PcDownload | null> {
  for (const url of feedCandidates()) {
    const found = await fromFeed(url);
    if (found) return found;
  }
  return fromGitHubRelease();
}

export function pcDownloadQueryOptions() {
  return queryOptions({
    queryKey: deviceKeys.download,
    queryFn: findPcDownload,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export function platformLabel(platform: string) {
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  if (platform === "linux") return "Linux";
  return platform || "未知系统";
}

export function bytesText(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** 「刚刚 / 3 分钟前 / 昨天 14:20」。 */
export function seenText(at: string | null, online: boolean) {
  if (online) return "在线";
  if (!at) return "从未连接";
  const ms = Date.now() - Date.parse(at);
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "刚刚在线";
  if (minutes < 60) return `${minutes} 分钟前在线`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前在线`;
  return `${new Date(at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} 在线`;
}

export const OUTCOME_LABEL: Record<string, { text: string; tone: "ok" | "warn" | "danger" | "muted" }> = {
  succeeded: { text: "成功", tone: "ok" },
  requested: { text: "进行中", tone: "muted" },
  failed: { text: "失败", tone: "danger" },
  refused: { text: "已拒绝", tone: "warn" },
  denied: { text: "用户拒绝", tone: "warn" },
  expired: { text: "审批超时", tone: "warn" },
  offline: { text: "设备离线", tone: "muted" },
  timeout: { text: "超时", tone: "danger" },
  approved_local: { text: "PC 上批准", tone: "ok" },
  denied_local: { text: "PC 上拒绝", tone: "warn" },
};

export const ACTION_LABEL: Record<string, string> = {
  enrolled: "登记设备",
  revoked: "撤销设备",
  unenrolled: "PC 上退出登录",
  config_changed: "修改设置",
  kill_switch_on: "紧急停止",
  kill_switch_off: "解除紧急停止",
};
