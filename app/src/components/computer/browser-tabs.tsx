import { IconLoader2, IconPlus, IconWorld, IconX } from "@tabler/icons-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { siteMonogram } from "@/lib/browser-bookmarks";
import { DARK_INK_LUMINANCE, hexLuminance, useDarkInk } from "@/lib/favicon-tone";
import { type BrowserTab, humanTab, useBrowserTabs } from "@/lib/computers/tabs";

/**
 * 机器人浏览器的标签栏（DESIGN.md §95）。
 *
 * 机器人和人看到的是同一组真标签（云端 Chromium 里的页面）。人接管时可以点着切、× 关、+ 新开；
 * 只看着的时候标签栏照样显示，当前那个高亮——看得出机器人在哪个标签上，点不动（提示先接管）。
 * 标签栏只在放大的浏览器里出现；右栏小画面上面不再放标签（DESIGN §96）。
 *
 * 图标在暗色主题里：深色墨图标（GitHub 这类单色黑图标、深色字母块）垫一块浅色小底板，免得黑上加黑
 * （`is-dark-ink`，lib/favicon-tone.ts）。
 */
export function TabFavicon({ tab, size = 16 }: { tab: Pick<BrowserTab, "favicon" | "title" | "url">; size?: number }) {
  const [broken, setBroken] = useState(false);
  const imgSrc = tab.favicon && !broken ? tab.favicon : undefined;
  const darkInk = useDarkInk(imgSrc);
  if (imgSrc)
    return (
      <img
        alt=""
        aria-hidden
        className={`btab-ic${darkInk ? " is-dark-ink" : ""}`}
        height={size}
        onError={() => setBroken(true)}
        src={imgSrc}
        width={size}
      />
    );
  if (!/^https?:\/\//i.test(tab.url)) return <IconWorld aria-hidden className="btab-ic is-glyph" size={size} />;
  const mono = siteMonogram(tab.title, tab.url);
  const monoDark = (hexLuminance(mono.color) ?? 1) < DARK_INK_LUMINANCE;
  return (
    <span aria-hidden className={`btab-ic is-mono${monoDark ? " is-dark-ink" : ""}`} style={{ background: mono.color, width: size, height: size }}>
      {mono.letter}
    </span>
  );
}

export function TabStrip({
  computerId,
  driving,
  poll,
  end,
}: {
  computerId: string;
  /** 人拿着控制权（可以切 / 关 / 开）。 */
  driving: boolean;
  /** 没有直播 socket 推标签时自己轮询。 */
  poll: boolean;
  /** 标签栏最右端（放大页把关闭按钮放在这里）。 */
  end?: ReactNode;
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

  if (!view || view.tabs.length === 0)
    return end ? (
      <div className="btabs is-empty">
        <div className="btabs-lead" />
        <div className="btabs-end">{end}</div>
      </div>
    ) : null;
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
    <div className={`btabs${view.running ? "" : " is-saved"}`}>
      {/* 标签 + 「+」挨在一起（和 Chrome / Edge 一样「+」紧跟最后一个标签），右端留给 `end`。 */}
      <div className="btabs-lead">
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
                aria-disabled={!canAct}
                className="btab-main"
                onClick={() => {
                  if (!active) void run(`a:${tab.id}`, "activate", tab.id);
                }}
                onAuxClick={(event) => {
                  // 中键关标签，和桌面浏览器一样。
                  if (event.button === 1) void run(`c:${tab.id}`, "close", tab.id);
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
              {canAct ? (
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
      </div>
      {end ? <div className="btabs-end">{end}</div> : null}
      {problem ? (
        <p className="btabs-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
