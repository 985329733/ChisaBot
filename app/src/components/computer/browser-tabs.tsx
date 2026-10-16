import { IconLoader2, IconPlus, IconWorld, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { siteMonogram } from "@/lib/browser-bookmarks";
import { type BrowserTab, humanTab, useBrowserTabs } from "@/lib/computers/tabs";

/**
 * 机器人浏览器的标签栏（DESIGN.md §XX）。
 *
 * 机器人和人看到的是同一组真标签（云端 Chromium 里的页面）。人接管时可以点着切、× 关、+ 新开；
 * 只看着的时候标签栏照样显示，当前那个高亮——看得出机器人在哪个标签上，点不动（提示先接管）。
 * `compact` 是右栏小画面上面那一条：只有标签、没有 + 和 ×，点一下打开大屏。
 */
export function TabFavicon({ tab, size = 16 }: { tab: Pick<BrowserTab, "favicon" | "title" | "url">; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (tab.favicon && !broken)
    return (
      <img
        alt=""
        aria-hidden
        className="btab-ic"
        height={size}
        onError={() => setBroken(true)}
        src={tab.favicon}
        width={size}
      />
    );
  if (!/^https?:\/\//i.test(tab.url)) return <IconWorld aria-hidden className="btab-ic is-glyph" size={size} />;
  const mono = siteMonogram(tab.title, tab.url);
  return (
    <span aria-hidden className="btab-ic is-mono" style={{ background: mono.color, width: size, height: size }}>
      {mono.letter}
    </span>
  );
}

export function TabStrip({
  computerId,
  driving,
  poll,
  compact = false,
  onPick,
}: {
  computerId: string;
  /** 人拿着控制权（可以切 / 关 / 开）。 */
  driving: boolean;
  /** 没有直播 socket 推标签时自己轮询。 */
  poll: boolean;
  compact?: boolean;
  /** compact 时点标签：打开大屏。 */
  onPick?: () => void;
}) {
  const view = useBrowserTabs(computerId, poll);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const activeId = view?.activeId ?? view?.tabs.find((tab) => tab.active)?.id ?? null;

  useEffect(() => {
    if (!problem) return;
    const timer = setTimeout(() => setProblem(null), 4000);
    return () => clearTimeout(timer);
  }, [problem]);

  // 当前标签滚进可见范围（标签多、被挤到右边时）。
  useEffect(() => {
    if (!activeId) return;
    const node = strip.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeId)}"]`);
    node?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [activeId]);

  if (!view || view.tabs.length === 0) return null;
  const full = view.tabs.length >= view.max;
  const canAct = driving && view.running;

  const run = async (key: string, action: "new" | "activate" | "close", id?: string) => {
    if (!canAct || busy) return;
    setBusy(key);
    setProblem(null);
    const started = Date.now();
    const result = await humanTab(computerId, action, id);
    // 最少 300ms，免得一闪（DESIGN §6 按钮状态机）。
    const left = 300 - (Date.now() - started);
    if (left > 0) await new Promise((resolve) => setTimeout(resolve, left));
    setBusy(null);
    if (!result.ok) setProblem(result.error);
  };

  const hint = !view.running
    ? "浏览器没在运行；下次打开时会恢复这些标签"
    : driving
      ? undefined
      : "接管控制后可以切换、关闭和新开标签";

  return (
    <div className={`btabs${compact ? " is-compact" : ""}${view.running ? "" : " is-saved"}`}>
      <div aria-label={"标签页"} className="btabs-track" ref={strip} role="tablist">
        {view.tabs.map((tab) => {
          const active = tab.id === activeId || (!activeId && tab.active);
          return (
            <div
              aria-selected={active}
              className={`btab${active ? " is-active" : ""}`}
              data-tab-id={tab.id}
              key={tab.id}
              role="tab"
              title={hint ? `${tab.title}\n${hint}` : tab.title}
            >
              <button
                aria-disabled={!canAct && !compact}
                className="btab-main"
                onClick={() => {
                  if (compact) onPick?.();
                  else if (!active) void run(`a:${tab.id}`, "activate", tab.id);
                }}
                onAuxClick={(event) => {
                  // 中键关标签，和桌面浏览器一样。
                  if (event.button === 1 && !compact) void run(`c:${tab.id}`, "close", tab.id);
                }}
                type="button"
              >
                {busy === `a:${tab.id}` ? (
                  <IconLoader2 aria-hidden className="btab-ic is-glyph animate-spin" size={16} />
                ) : (
                  <TabFavicon tab={tab} />
                )}
                <span className="btab-t">{tab.title}</span>
              </button>
              {!compact && canAct ? (
                <button
                  aria-label={`关闭标签页「${tab.title}」`}
                  className="btab-x"
                  disabled={Boolean(busy)}
                  onClick={() => void run(`c:${tab.id}`, "close", tab.id)}
                  title={"关闭标签页"}
                  type="button"
                >
                  {busy === `c:${tab.id}` ? (
                    <IconLoader2 className="animate-spin" size={12} />
                  ) : (
                    <IconX size={12} stroke={2.2} />
                  )}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {!compact ? (
        <button
          aria-label={"新标签页"}
          className="btabs-new"
          disabled={!canAct || Boolean(busy) || full}
          onClick={() => void run("new", "new")}
          title={full ? `最多同时打开 ${view.max} 个标签页` : canAct ? "新标签页" : (hint ?? "新标签页")}
          type="button"
        >
          {busy === "new" ? <IconLoader2 className="animate-spin" size={16} /> : <IconPlus size={16} />}
        </button>
      ) : view.tabs.length > 1 ? (
        <span className="btabs-count" title={`${view.tabs.length} 个标签页`}>
          {view.tabs.length}
        </span>
      ) : null}
      {problem ? (
        <p className="btabs-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
