import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createStateStore, JSONUIProvider, Renderer, type Spec } from "@json-render/react";
import { inspectRenderUiSpec } from "../../shared/json-render/catalog";
import {
  canTween,
  countdownParts,
  domainOf,
  formatLike,
  heatLevel,
  initials,
  layoutSeries,
  monotonePath,
  parseNumeric,
  relativeTime,
  ringSegments,
  safeHttp,
  safeHttps,
  sampleLabels,
  seriesTrend,
  shortNumber,
  toNumber,
  trendOfText,
} from "@/lib/copilot/json-render/rich-utils";

/** 富组件（DESIGN.md §29）：纯函数 + 用真实注册表把每个新组件画一遍。 */

describe("rich-utils", () => {
  test("numbers are read out of display strings", () => {
    expect(toNumber("$81,272.5")).toBe(81272.5);
    expect(toNumber("-3.1%")).toBe(-3.1);
    expect(toNumber("−5")).toBe(-5);
    expect(toNumber("暂无")).toBeNull();
    expect(toNumber(42)).toBe(42);
  });

  test("display values split into prefix / number / suffix and format back the same way", () => {
    const price = parseNumeric("$81,272");
    expect(price).toMatchObject({ prefix: "$", value: 81272, grouped: true, suffix: "", decimals: 0 });
    expect(formatLike(80123.4, price!)).toBe("$80,123");
    const temp = parseNumeric("26.9℃");
    expect(formatLike(27.25, temp!)).toBe("27.3℃");
    const delta = parseNumeric("+1.20%");
    expect(formatLike(0.5, delta!)).toBe("+0.50%");
    expect(formatLike(-0.5, delta!)).toBe("-0.50%");
    expect(parseNumeric("31°/24°")).toBeNull();
    expect(parseNumeric("10月13日")).toBeNull();
    expect(canTween(parseNumeric("$1,000"), parseNumeric("$1,200"))).toBe(true);
    expect(canTween(parseNumeric("1,000 USD"), parseNumeric("$1,200"))).toBe(false);
  });

  test("monotone path passes through every point and never overshoots", () => {
    const d = monotonePath([{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 10 }]);
    expect(d.startsWith("M0,10C")).toBe(true);
    expect(d.endsWith("30,10")).toBe(true);
    // flat segment between two equal points stays flat: control points keep y = 0
    expect(d).toContain("C13.33,0 16.67,0 20,0");
    expect(monotonePath([])).toBe("");
  });

  test("series layout splits at gaps and pads a flat line", () => {
    const { segments, min, max } = layoutSeries([[1, 2, null, 4]], 300, 100);
    expect(segments[0]?.length).toBe(2);
    expect(min).toBe(1);
    expect(max).toBe(4);
    const flat = layoutSeries([[5, 5]], 300, 100);
    expect(flat.max).toBeGreaterThan(flat.min);
  });

  test("trends, relative time, countdown", () => {
    expect(seriesTrend([1, null, 3])).toBe("up");
    expect(trendOfText("-120")).toBe("down");
    expect(trendOfText("▲ 2%")).toBe("up");
    const now = Date.parse("2026-10-13T10:00:00+08:00");
    expect(relativeTime("2026-10-13T09:57:00+08:00", now)).toBe("3 分钟前");
    expect(relativeTime("2026-10-13T12:00:00+08:00", now)).toBe("2 小时后");
    expect(relativeTime("2026-10-13T09:59:50+08:00", now)).toBe("刚刚");
    expect(countdownParts("2026-10-14T11:02:03+08:00", now)).toMatchObject({ days: 1, hours: 1, minutes: 2, seconds: 3, done: false });
    expect(countdownParts("2026-10-12T00:00:00+08:00", now)?.done).toBe(true);
    expect(countdownParts("下周五", now)).toBeNull();
  });

  test("links and images are only http(s) / https", () => {
    expect(safeHttp("javascript:alert(1)")).toBeNull();
    expect(safeHttp("https://a.test/x")).toBe("https://a.test/x");
    expect(safeHttps("http://a.test/x.png")).toBeNull();
    expect(domainOf("https://www.reuters.com/world/x")).toBe("reuters.com");
  });

  test("small helpers", () => {
    expect(shortNumber(123456)).toBe("123,456");
    expect(shortNumber(1234567)).toBe("123万");
    expect(shortNumber(250000000)).toBe("2.5亿");
    expect(initials("程天宇")).toBe("程");
    expect(initials("vercel next")).toBe("VN");
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(10, 10)).toBe(4);
    expect(sampleLabels(10, 4)).toEqual([0, 3, 6, 9]);
    expect(ringSegments([1, 0, 3]).map((s) => s.index)).toEqual([0, 2]);
  });
});

describe("rich components render", () => {
  beforeAll(() => {
    GlobalRegistrator.register();
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });
  afterEach(() => cleanup());
  afterAll(() => GlobalRegistrator.unregister());

  async function draw(spec: Record<string, unknown>) {
    const { jsonRenderRegistry } = await import("@/lib/copilot/json-render/registry");
    const verdict = inspectRenderUiSpec(JSON.stringify(spec));
    expect(verdict.ok).toBe(true);
    const safe = verdict.ok ? verdict.spec : (spec as unknown as Spec);
    const store = createStateStore({});
    return render(
      <div className="jr-surface">
        <JSONUIProvider handlers={{}} registry={jsonRenderRegistry} store={store}>
          <Renderer registry={jsonRenderRegistry} spec={safe as Spec} />
        </JSONUIProvider>
      </div>,
    );
  }

  test("every new component draws something", async () => {
    const view = await draw({
      root: "r",
      elements: {
        r: { type: "Stack", props: {}, children: ["hero", "m", "chart", "bar", "ring", "gauge", "heat", "tl", "kv", "cd", "st", "dl", "av", "ln", "sep", "list"] },
        hero: { type: "Hero", props: { title: "多云", value: "26.9℃", eyebrow: "香港 · 现在", tone: "info" }, children: [] },
        m: { type: "Metric", props: { label: "现价", value: "$81,272", delta: "24h -3.1%", trend: "down", spark: [3, 2, 1], variant: "tinted", icon: "currency-bitcoin" }, children: [] },
        chart: { type: "Chart", props: { labels: ["10/12", "10/13"], data: [1, 2], unit: "$" }, children: [] },
        bar: { type: "Chart", props: { kind: "bar", labels: ["a", "b", "c"], series: [{ name: "x", data: [1, 2, 3] }, { name: "y", data: [3, 2, 1] }] }, children: [] },
        ring: { type: "Ring", props: { value: 42, label: "CPU" }, children: [] },
        gauge: { type: "Gauge", props: { value: 95, dangerAt: 90, unit: "%" }, children: [] },
        heat: { type: "HeatStrip", props: { values: [0, 1, 2, 3], label: "提交" }, children: [] },
        tl: { type: "Timeline", props: { items: [{ title: "已发货", time: "10/13 08:00" }, { title: "已签收" }] }, children: [] },
        kv: { type: "KeyValue", props: { items: [{ label: "IP", value: "10.0.0.8", mono: true, copy: "10.0.0.8" }] }, children: [] },
        cd: { type: "Countdown", props: { target: "2099-01-01T00:00:00+08:00", label: "距离" }, children: [] },
        st: { type: "Status", props: { label: "官网", tone: "success", pulse: true, detail: "200 · 85ms" }, children: [] },
        dl: { type: "Delta", props: { value: "+3.2%", label: "24h" }, children: [] },
        av: { type: "Avatar", props: { name: "owner/repo", shape: "square", href: "https://github.com/owner/repo" }, children: [] },
        ln: { type: "Link", props: { url: "https://www.reuters.com/x", title: "标题", meta: "2 小时前" }, children: [] },
        sep: { type: "Separator", props: { label: "更早" }, children: [] },
        list: { type: "List", props: { items: [{ title: "新闻一", href: "https://news.test/1", time: "2026-10-13T08:00:00Z", badge: "新" }] }, children: [] },
      },
    });
    const { container } = view;
    for (const selector of [".jr-hero", ".jr-metric.is-tinted", ".jr-spark", ".jr-chart svg", ".jr-bars .jr-bar", ".jr-ring-arc", ".jr-gauge-arc", ".jr-heat-cell.is-l4", ".jr-tl-item", ".jr-kv-row", ".jr-countdown-u", ".jr-dot.is-pulse", ".jr-delta", ".jr-avatar-face", ".jr-link .jr-favicon", ".jr-sep-l"]) {
      expect(container.querySelector(selector)).not.toBeNull();
    }
    expect(container.textContent).toContain("多云");
    expect(container.textContent).toContain("reuters.com");
    // Gauge past dangerAt turns red
    expect(container.querySelector(".jr-gauge")?.className).toContain("jr-tone-danger");
    // delta chip on the metric is a down chip
    expect(container.querySelector(".jr-metric .jr-delta-chip")?.className).toContain("jr-tone-danger");
    // links open in a new tab with noopener and show ↗
    const link = container.querySelector<HTMLAnchorElement>(".jr-list-row.jr-action");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
    expect(container.querySelector(".jr-list-go")).not.toBeNull();
  });

  test("tabs switch panes and accordions open", async () => {
    const { container, getByText } = await draw({
      root: "r",
      elements: {
        r: { type: "Stack", props: {}, children: ["tabs", "acc"] },
        tabs: { type: "Tabs", props: { tabs: ["今天", "本周"] }, children: ["a", "b"] },
        a: { type: "Text", props: { text: "今天的内容" }, children: [] },
        b: { type: "Text", props: { text: "本周的内容" }, children: [] },
        acc: { type: "Accordion", props: { title: "详情" }, children: ["c"] },
        c: { type: "Text", props: { text: "折叠的内容" }, children: [] },
      },
    });
    expect(container.textContent).toContain("今天的内容");
    expect(container.textContent).not.toContain("本周的内容");
    await act(async () => fireEvent.click(getByText("本周")));
    expect(container.textContent).toContain("本周的内容");
    const head = container.querySelector<HTMLButtonElement>(".jr-acc-head");
    expect(head?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => fireEvent.click(head!));
    expect(head?.getAttribute("aria-expanded")).toBe("true");
  });

  test("a changed value flashes and keeps the same element (refresh updates in place)", async () => {
    const { jsonRenderRegistry } = await import("@/lib/copilot/json-render/registry");
    const spec = (value: string) =>
      ({ root: "m", elements: { m: { type: "Metric", props: { label: "现价", value }, children: [] } } }) as unknown as Spec;
    const store = createStateStore({});
    const tree = (value: string) => (
      <JSONUIProvider handlers={{}} registry={jsonRenderRegistry} store={store}>
        <Renderer registry={jsonRenderRegistry} spec={spec(value)} />
      </JSONUIProvider>
    );
    const view = render(tree("$80,000"));
    const before = view.container.querySelector(".jr-metric");
    expect(view.container.querySelector(".jr-flash")).toBeNull();
    await act(async () => view.rerender(tree("$81,272")));
    expect(view.container.querySelector(".jr-metric")).toBe(before);
    expect(view.container.querySelector(".jr-flash")).not.toBeNull();
  });
});
