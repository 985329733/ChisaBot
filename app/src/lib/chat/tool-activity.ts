import { useSyncExternalStore } from "react";

/**
 * 聊天里是否显示「机器人做了什么」的过程行（工具调用、浏览步骤、思考过程）。
 *
 * 默认不显示（用户 2026-10-12：隐藏思考过程和工具调用）。只有需要用户处理的东西照常出现：审批卡片、
 * 授权 / 登录按钮、render_ui 画出的界面。排查问题时可以在 管理后台 → 系统更新 → 「调试：显示工具调用」
 * 打开，只对这台浏览器生效（localStorage），不影响别人。
 */
export const TOOL_ACTIVITY_KEY = "chisabot-show-tool-activity";
const EVENT = "chisabot-tool-activity";

function read(): boolean {
  try {
    return window.localStorage.getItem(TOOL_ACTIVITY_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

export function useToolActivityVisible(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

export function setToolActivityVisible(visible: boolean) {
  try {
    if (visible) window.localStorage.setItem(TOOL_ACTIVITY_KEY, "1");
    else window.localStorage.removeItem(TOOL_ACTIVITY_KEY);
  } catch {
    // 无痕模式等拿不到 localStorage：保持默认（隐藏）。
  }
  window.dispatchEvent(new Event(EVENT));
}
