import path from "node:path";
import type { DeviceOperation } from "../../../shared/devices";

/**
 * 「允许的文件夹」之外的路径（docs/pc-node.md §5.3）。
 *
 * PC 端只让文件类操作碰允许的文件夹（pc/src/agent/ops.js resolveInRoots）。以前机器人要读允许的文件夹之外的
 * 地方（例如 C:\AI），审批卡只写「列出：C:\AI」，用户点了批准，PC 还是拒绝「路径不在允许的文件夹内」——
 * 白批一次。现在服务器先按设备的平台判断路径在不在允许的文件夹里；不在就照样走审批（偏好是「直接做」也要问），
 * 卡片上写明「批准后会把这个文件夹加入允许的文件夹」，批准后先加文件夹、推配置给 PC，再发调用。
 *
 * 这里只做字符串层面的判断（服务器看不到 PC 的符号链接）；PC 端照旧用 realpath 再查一遍，两边任何一边说不就不执行。
 */

/** 每个操作的路径参数，以及要加入的是路径本身（文件夹）还是它所在的文件夹（文件）。 */
const PATH_ARGS: Partial<Record<DeviceOperation, { key: string; kind: "dir" | "file" | "auto" }>> = {
  list_files: { key: "path", kind: "dir" },
  search: { key: "path", kind: "auto" },
  read_file: { key: "path", kind: "file" },
  write_file: { key: "path", kind: "file" },
  edit_file: { key: "path", kind: "file" },
  file_download: { key: "path", kind: "file" },
  file_upload: { key: "path", kind: "file" },
  git: { key: "cwd", kind: "dir" },
  apply_patch: { key: "cwd", kind: "dir" },
};

function api(platform: string | null | undefined) {
  return platform === "win32" ? path.win32 : path.posix;
}

/** 绝对路径？（Windows：盘符 / UNC；其它：/ 开头）。相对路径 PC 会放到第一个允许的文件夹下，不算在外面。 */
function absolute(platform: string | null | undefined, raw: string): boolean {
  if (platform === "win32") return /^(?:[a-zA-Z]:[\\/]|\\\\)/.test(raw);
  return raw.startsWith("/");
}

/** target 是否在 root 之内（含相等）。Windows 不区分大小写，\ 和 / 都算分隔符。 */
export function insideRoot(platform: string | null | undefined, target: string, root: string): boolean {
  const P = api(platform);
  const fold = (value: string) => (platform === "win32" ? value.toLowerCase() : value);
  const a = fold(P.resolve(target));
  const b = fold(P.resolve(root));
  if (a === b) return true;
  return a.startsWith(b.endsWith(P.sep) ? b : b + P.sep);
}

/** 盘符根 / 系统根（C:\、/）——加进允许的文件夹等于放开整个盘，卡片上要说清楚。 */
export function isDriveRoot(platform: string | null | undefined, folder: string): boolean {
  const P = api(platform);
  const resolved = P.resolve(folder);
  return P.dirname(resolved) === resolved;
}

export type OutsideRoots = {
  /** 机器人请求的路径（规范化后）。 */
  path: string;
  /** 批准后要加入允许的文件夹的那个文件夹。 */
  folder: string;
  /** 是不是整个盘（C:\ 或 /）。 */
  wholeDrive: boolean;
};

/**
 * 这次调用碰到的路径在不在允许的文件夹之外；在外面就返回要加入的文件夹。完全访问时 PC 不查文件夹，调用方不该来问。
 */
export function outsideRoots(
  platform: string | null | undefined,
  roots: readonly string[],
  operation: DeviceOperation,
  args: Record<string, unknown>,
): OutsideRoots | null {
  const spec = PATH_ARGS[operation];
  if (!spec) return null;
  const value = args[spec.key];
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  if (!absolute(platform, raw)) {
    // 相对路径落在第一个允许的文件夹下；一个都没有时 PC 会提示先设置文件夹，这里不猜。
    return null;
  }
  const P = api(platform);
  const resolved = P.resolve(raw);
  if (roots.some((root) => insideRoot(platform, resolved, root))) return null;
  let folder = resolved;
  if (spec.kind === "file") folder = P.dirname(resolved);
  else if (spec.kind === "auto" && /\.[A-Za-z0-9]{1,8}$/.test(P.basename(resolved))) folder = P.dirname(resolved);
  return { path: resolved, folder, wholeDrive: isDriveRoot(platform, folder) };
}

/** 卡片 / PC 弹窗上追加的一句话。 */
export function outsideRootsNote(outside: OutsideRoots): string {
  return outside.wholeDrive
    ? `${outside.folder} 不在允许的文件夹里；批准后会把整个 ${outside.folder} 加入允许的文件夹`
    : `${outside.folder} 不在允许的文件夹里；批准后会把它加入允许的文件夹`;
}
