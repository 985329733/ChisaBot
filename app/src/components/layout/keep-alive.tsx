import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

/** 藏着的聊天留多久（之后卸载，回来走正常的打开：先画上次的样子，再接入）。 */
export const KEPT_TTL_MS = 10 * 60_000;

export type KeptState = {
  /** 地址正停在留着的这一页上（或 `idleVisible`）。 */
  visible: boolean;
  /** 每次从藏着变回看得见时加一。 */
  epoch: number;
};

/**
 * 主区里「留着的一页 + 当前路由」（DESIGN.md §98）。
 *
 * - `address` 不为 null（地址正是那一页，比如 `/channel/:id`）：留着的那页看得见，路由那一层不占位置
 *   （那条路由自己什么都不画）。`address` 换了（换了一段对话）就换成新的那页。
 * - `address` 为 null（别的页面）：路由那一层盖在上面（`absolute inset-0`，和主区一样的 flex 列），留着的那页
 *   藏在下面——不卸载，`visibility: hidden` + `inert` + `aria-hidden`，宽高冻在离开时的样子（右栏、横幅没了主区
 *   会变宽变高，不冻的话整段对话要重排，回来时滚动位置就对不上）。藏够 `ttlMs` 就卸载。
 * - `idleVisible`：地址不是那一页，但正在跳过去（`/` → 最近的对话），留着的那页先露着，不空一下。
 *
 * 路由那一层永远是同一个元素、只换样式，路由内容不会因为留没留着而重新挂载。
 */
export function KeepAliveStage<T>({
  address,
  idleVisible = false,
  same,
  renderKept,
  ttlMs = KEPT_TTL_MS,
  children,
}: {
  address: T | null;
  idleVisible?: boolean;
  same: (a: T, b: T) => boolean;
  renderKept: (kept: T, state: KeptState) => ReactNode;
  ttlMs?: number;
  children: ReactNode;
}) {
  const [kept, setKept] = useState<T | null>(address);
  if (address !== null && (kept === null || !same(address, kept))) setKept(address);
  const shown = address !== null || (kept !== null && idleVisible);
  const visible = kept !== null && shown;

  const [epoch, setEpoch] = useState(0);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setEpoch((n) => n + 1);
  }

  useEffect(() => {
    if (visible || kept === null) return;
    const timer = window.setTimeout(() => setKept(null), ttlMs);
    return () => window.clearTimeout(timer);
  }, [visible, kept, ttlMs]);

  // 看得见时一直记着尺寸；藏起来那一刻（同一次提交、新页面画出来之前）用记下的尺寸冻住。
  const box = useRef<HTMLDivElement>(null);
  const size = useRef<{ width: number; height: number } | null>(null);
  const hasKept = kept !== null;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !visible) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) size.current = { width: rect.width, height: rect.height };
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible, hasKept]);

  const frozen = visible ? null : size.current;
  const keptStyle: CSSProperties | undefined = visible
    ? undefined
    : {
        visibility: "hidden",
        pointerEvents: "none",
        ...(frozen ? { flex: "none", width: frozen.width, height: frozen.height } : {}),
      };

  return (
    <div className="keep-stage relative flex min-h-0 min-w-0 flex-1 flex-col" data-kept-visible={visible ? "true" : "false"}>
      {kept !== null ? (
        <div
          aria-hidden={visible ? undefined : true}
          className="kept-chat flex min-h-0 min-w-0 flex-1 flex-col"
          data-testid="kept-page"
          data-visible={visible ? "true" : "false"}
          inert={!visible}
          ref={box}
          style={keptStyle}
        >
          {renderKept(kept, { visible, epoch })}
        </div>
      ) : null}
      <div
        className={shown ? "route-layer contents" : "route-layer absolute inset-0 z-[1] flex min-h-0 min-w-0 flex-col"}
        data-testid="route-layer"
      >
        {children}
      </div>
    </div>
  );
}
