import { Outlet, useRouterState } from "@tanstack/react-router";
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { GlassShell } from "@/components/layout/glass-shell";
import type { ShellScope } from "@/components/layout/glass-topbar";
import { LeftRail } from "@/components/layout/left-rail";
import { SelfHostBanner } from "@/components/layout/self-host-banner";
import { PanelRail } from "@/components/panels/panel-rail";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";
import { type LeftMode, modeOfPath } from "@/lib/left-mode";
import { CHANNEL_ROUTE_ID, ChannelPage } from "@/components/channels/channel-page";

/**
 * 登录之后的那一个外壳（DESIGN.md §98）。
 *
 * 以前聊天（`_app`）、设置、管理各自画一个 `GlassShell`：从设置回聊天 = 整个外壳卸载再装一遍，聊天跟着卸载，
 * 回来时重新接入、回放、读历史，发送键闪成「停止」、气泡重排、右栏重载——用户看到的「切回来总要刷新一次」。
 *
 * 现在外壳只有一个，挂在 `_authed`：换页面只换左栏内容（聊天 / 设置 / 管理）、顶栏的 scope 和右栏是否显示。
 * 聊天由 `KeptChat` 画在主区里，离开时不卸载，只是藏起来（不可见、不可点、尺寸冻住不重排），回来时原样出现。
 * 没有外壳的页面（引导、登录授权）照旧直接画。
 */
export function AuthedShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === "/onboarding" || pathname.startsWith("/sign-in")) return <Outlet />;
  return <ShellFrame pathname={pathname} />;
}

function scopeOfPath(pathname: string): ShellScope {
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return "settings";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  return "app";
}

function ShellFrame({ pathname }: { pathname: string }) {
  const scope = scopeOfPath(pathname);
  const mode = modeOfPath(pathname);
  const switched = useModeSwitched(scope === "app" ? mode : null);
  const sidebar =
    scope === "settings" ? (
      <SettingsSidebar className="glass-sidebar-container" />
    ) : scope === "admin" ? (
      <AdminSidebar className="glass-sidebar-container" />
    ) : (
      <LeftRail className="glass-sidebar-container" mode={mode} />
    );
  return (
    <GlassShell
      banner={scope === "app" ? <SelfHostBanner /> : undefined}
      // 设置 / 管理里不改 data-mode：改了再改回来，主区的淡入动画会在回聊天时重播一次。
      mode={switched ? mode : undefined}
      // 右栏面板卡只属于机器人；在设置 / 管理 / Claude Code 里藏起来而不是卸载，回来不重载。
      right={<PanelRail />}
      rightHidden={!(scope === "app" && mode === "bots")}
      scope={scope}
      sidebar={sidebar}
    >
      <KeepAliveStage pathname={pathname} />
    </GlassShell>
  );
}

/** 第一次「机器人 ↔ Claude Code」切换之后才给主区加淡入（打开应用时不闪一下，DESIGN.md §84）。 */
function useModeSwitched(mode: LeftMode | null) {
  const first = useRef(mode);
  const [switched, setSwitched] = useState(false);
  if (first.current === null && mode !== null) first.current = mode;
  if (!switched && mode !== null && first.current !== null && mode !== first.current) setSwitched(true);
  return switched;
}

type ChatAddress = { channelId: string; settings?: boolean; watch?: boolean };

/** 当前地址是不是一段聊天（`/channel/:id`），是的话它的参数。 */
function useChatAddress(): ChatAddress | null {
  const key = useRouterState({
    select: (s) => {
      const match = s.matches.find((m) => m.routeId === CHANNEL_ROUTE_ID);
      if (!match) return "";
      const search = match.search as { settings?: boolean; watch?: boolean };
      return JSON.stringify([
        (match.params as { channelId: string }).channelId,
        search.settings === true,
        search.watch === true ? true : search.watch === false ? false : null,
      ]);
    },
  });
  if (!key) return null;
  const [channelId, settings, watch] = JSON.parse(key) as [string, boolean, boolean | null];
  return { channelId, ...(settings ? { settings: true } : {}), ...(watch === null ? {} : { watch }) };
}

const sameAddress = (a: ChatAddress | null, b: ChatAddress | null) =>
  a === b || (a !== null && b !== null && a.channelId === b.channelId && a.settings === b.settings && a.watch === b.watch);

/** 藏着的聊天留多久（之后卸载，回来走正常的打开：先画上次的样子，再接入）。 */
export const KEPT_CHAT_TTL_MS = 10 * 60_000;

/**
 * 主区：留着的聊天 + 当前路由。
 *
 * - 地址是聊天（或 `/` 正在跳转到聊天）：留着的聊天看得见，路由那一层不占位置（聊天路由本身什么都不画）。
 * - 别的页面：路由那一层盖在上面（`absolute inset-0`，和主区一样的 flex 列），聊天藏在下面——
 *   `visibility: hidden` + `inert`，宽高冻在离开时的样子（右栏、横幅没了主区会变宽变高，不冻的话整段对话要重排，
 *   回来时滚动位置就对不上了）。
 */
function KeepAliveStage({ pathname }: { pathname: string }) {
  const address = useChatAddress();
  const [kept, setKept] = useState<ChatAddress | null>(address);
  if (address && !sameAddress(address, kept)) setKept(address);
  const chatVisible = address !== null || (kept !== null && pathname === "/");
  const visible = kept !== null && chatVisible;

  // 回到看得见的次数：给聊天当「这是一次回来」的记号。
  const [epoch, setEpoch] = useState(0);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setEpoch((n) => n + 1);
  }

  // 藏太久就放掉（不再每 2 秒问服务器这段对话的动静）。
  useEffect(() => {
    if (visible || kept === null) return;
    const timer = window.setTimeout(() => setKept(null), KEPT_CHAT_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [visible, kept]);

  // 看得见时一直记着尺寸；藏起来那一刻用记下的尺寸冻住（在新页面画出来之前，同一次提交里）。
  const box = useRef<HTMLDivElement>(null);
  const size = useRef<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !visible) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) size.current = { width: rect.width, height: rect.height };
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible, kept?.channelId]);

  const frozen = !visible && size.current;
  const keptStyle: CSSProperties | undefined = visible
    ? undefined
    : {
        visibility: "hidden",
        pointerEvents: "none",
        ...(frozen ? { flex: "none", width: size.current?.width, height: size.current?.height } : {}),
      };

  return (
    <div className="keep-stage relative flex min-h-0 min-w-0 flex-1 flex-col" data-chat-visible={visible ? "true" : "false"}>
      {kept ? (
        <div
          aria-hidden={visible ? undefined : true}
          className="kept-chat flex min-h-0 min-w-0 flex-1 flex-col"
          data-kept-chat={kept.channelId}
          data-visible={visible ? "true" : "false"}
          inert={!visible}
          ref={box}
          style={keptStyle}
        >
          <ChannelPage
            channelId={kept.channelId}
            epoch={epoch}
            settings={kept.settings}
            visible={visible}
            watch={kept.watch}
          />
        </div>
      ) : null}
      {/* 同一个位置、只换样式：路由内容不会因为聊天留没留着而重新挂载。 */}
      <div className={chatVisible ? "route-layer contents" : "route-layer absolute inset-0 z-[1] flex min-h-0 min-w-0 flex-col"}>
        <Outlet />
      </div>
    </div>
  );
}
