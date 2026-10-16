import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { createContext, useContext, useEffect } from "react";
import { currentUserQueryOptions } from "@/lib/auth/queries";
import { rememberLeftMode } from "@/lib/cloud-cc";
import { type LeftMode, modeTarget, preloadMode } from "@/lib/left-mode";
import { T } from "@/components/ui/button";
import { useOptionalSidebar } from "@/components/ui/sidebar";

/**
 * 左栏里两块内容（机器人 / Claude Code）都挂着、只显示一块（`LeftRail`，DESIGN.md §84）。
 * 藏起来那块里的切换不带 testid、不抢焦点，测试和读屏只看得到正在显示的那个。
 */
export const RailPaneActive = createContext(true);

/**
 * 左栏顶部「机器人｜Claude Code」（ADR-0014 修订 ADR-0001，DESIGN.md §73.2 / §84）。机器人那边仍然只放机器人。
 * 只有管理员看得到（Claude Code 用的是管理员自己的 Claude 订阅）。
 * 切换是同一个外壳里的原地切换：外壳、顶栏、左栏容器都不动，只换左栏内容和主区；
 * 机器人回到上次停的对话，Claude Code 回到上次的会话。空闲时和指针移上来时先把对面预取好。
 */
export function LeftModeSwitch({ mode }: { mode: LeftMode }) {
  const user = useQuery(currentUserQueryOptions());
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const active = useContext(RailPaneActive);
  const sidebar = useOptionalSidebar();
  const admin = user.data?.role === "admin";
  const other: LeftMode = mode === "bots" ? "cc" : "bots";

  // 空闲时预取对面（分包 + 第一眼的数据），第一次点也不等。
  useEffect(() => {
    if (!admin || !active) return;
    const run = () => preloadMode(router, queryClient, other);
    const idle = window.requestIdleCallback?.(run, { timeout: 3000 });
    const timer = idle === undefined ? window.setTimeout(run, 1500) : undefined;
    return () => {
      if (idle !== undefined) window.cancelIdleCallback?.(idle);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [admin, active, other, router, queryClient]);

  if (!admin) return null;
  const warm = (next: LeftMode) => {
    if (next !== mode) preloadMode(router, queryClient, next);
  };
  const go = (next: LeftMode) => {
    if (next === mode) return;
    rememberLeftMode(next);
    // 手机上切换是在抽屉里点的：和以前一样收起抽屉，直接看到那边的主页面。
    if (sidebar?.isMobile) sidebar.setOpenMobile(false);
    void navigate(modeTarget(next) as Parameters<typeof navigate>[0]);
  };
  return (
    <div
      aria-label="左栏内容"
      className="sg-segmented cc-mode-switch"
      data-testid={active ? "left-mode-switch" : undefined}
      role="radiogroup"
    >
      <button
        aria-checked={mode === "bots"}
        className="sg-segmented-item"
        onClick={() => go("bots")}
        onFocus={() => warm("bots")}
        onPointerEnter={() => warm("bots")}
        onPointerDown={() => warm("bots")}
        role="radio"
        type="button"
      >
        <T>{"机器人"}</T>
      </button>
      <button
        aria-checked={mode === "cc"}
        className="sg-segmented-item"
        data-testid={active ? "left-mode-cc" : undefined}
        onClick={() => go("cc")}
        onFocus={() => warm("cc")}
        onPointerEnter={() => warm("cc")}
        onPointerDown={() => warm("cc")}
        role="radio"
        type="button"
      >
        <T>{"Claude Code"}</T>
      </button>
    </div>
  );
}
