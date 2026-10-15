/**
 * 一次工具调用 → 卡片上那一行「当前步骤」（中文、短）。
 *
 * 后台任务卡片（§38.3，服务器 `workers/service.ts`）和主对话的干活卡（§70，`components/chat/work-card.tsx`）
 * 用同一份，所以两处说法一致。返回 null = 这一步不改那一行（例如维护清单）。
 */
const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

function hostOf(url: unknown): string {
  if (typeof url !== "string") return "网页";
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "workspace.local") return "工作区里的页面";
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return clip(url, 40);
  }
}

/** 把工人的一次工具调用翻成卡片上那一行「当前步骤」。返回 null 的不改那一行。 */
export function describeWorkerStep(name: string, args: Record<string, unknown>): string | null {
  const text = (value: unknown, limit = 24) => (typeof value === "string" && value.trim() ? clip(value.trim(), limit) : "");
  switch (name) {
    case "worker_plan": return null;
    case "web_search": return text(args.query) ? `正在搜索「${text(args.query)}」` : "正在搜索";
    case "web_fetch": return `正在读取 ${hostOf(args.url)}`;
    case "computer_navigate": return `正在打开 ${hostOf(args.url)}`;
    case "computer_snapshot": return "正在查看页面上的按钮和输入框";
    case "computer_read": return "正在阅读页面";
    case "computer_screenshot": return "正在看页面";
    case "computer_click": return "正在点击";
    case "computer_type": return "正在填写";
    case "computer_key": return "正在按键";
    case "computer_scroll": return "正在滚动页面";
    case "computer_write_file": return text(args.path) ? `正在写文件 ${text(args.path)}` : "正在写文件";
    case "computer_read_file": return "正在读文件";
    case "computer_list_files": return "正在查看工作区";
    case "computer_run_command": return "正在运行命令";
    case "computer_request_help":
    case "computer_handoff": return "正在请你帮忙";
    case "render_ui": return "正在整理成卡片";
    default:
      if (name.startsWith("panel_")) return "正在更新面板";
      if (name.startsWith("device_")) return "正在操作你的设备";
      if (name.startsWith("memory")) return "正在查记忆";
      return `正在使用 ${name}`;
  }
}
