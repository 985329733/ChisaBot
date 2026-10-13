import { describe, expect, test } from "bun:test";
import { CONTROL_HELD_NOTE, createLivePanelService } from "../src/live-panels/service";
import { cleanSources, nextRefreshAtTime, normalizeRefreshAt, parseRefreshAt, type LivePanelStore } from "../src/live-panels/store";
import { notifyControlReleased, onControlReleased } from "../src/computer/control-blocks";

/** 2026-10-13 生产实测里发现的面板问题（e2e：/workspace/work/cb-panel-e2e）。 */

describe("每天固定时刻刷新（refreshAt）", () => {
  test("规范化 HH:MM@时区", () => {
    expect(normalizeRefreshAt("8:00")).toBe("08:00@Asia/Shanghai");
    expect(normalizeRefreshAt("18：30", "Europe/Berlin")).toBe("18:30@Europe/Berlin");
    expect(normalizeRefreshAt("25:00")).toBeNull();
    expect(normalizeRefreshAt("08:00", "Mars/Base")).toBeNull();
    expect(parseRefreshAt("08:00@Asia/Shanghai")).toEqual({ hour: 8, minute: 0, timeZone: "Asia/Shanghai" });
  });

  test("下一次是当地时间的那个时刻（北京时间 08:00 = UTC 00:00）", () => {
    // 2026-10-13 21:10 北京时间 → 下一次 10/14 08:00 北京时间
    const from = Date.UTC(2026, 9, 13, 13, 10);
    expect(nextRefreshAtTime("08:00@Asia/Shanghai", from)?.toISOString()).toBe("2026-10-14T00:00:00.000Z");
    // 07:30 北京时间 → 当天 08:00
    expect(nextRefreshAtTime("08:00@Asia/Shanghai", Date.UTC(2026, 9, 13, 23, 30))?.toISOString()).toBe("2026-10-14T00:00:00.000Z");
    // 正好 08:00 → 明天（严格晚于 1 分钟）
    expect(nextRefreshAtTime("08:00@Asia/Shanghai", Date.UTC(2026, 9, 14, 0, 0))?.toISOString()).toBe("2026-10-15T00:00:00.000Z");
  });

  test("有夏令时的时区按当地时间（柏林 10 月底切冬令时）", () => {
    // 10/24 夏令时 UTC+2；10/26 冬令时 UTC+1
    expect(nextRefreshAtTime("09:00@Europe/Berlin", Date.UTC(2026, 9, 23, 12, 0))?.toISOString()).toBe("2026-10-24T07:00:00.000Z");
    expect(nextRefreshAtTime("09:00@Europe/Berlin", Date.UTC(2026, 9, 25, 12, 0))?.toISOString()).toBe("2026-10-26T08:00:00.000Z");
  });
});

describe("来源", () => {
  test("编出来的网址不当链接，名字留下；真网址照常", () => {
    expect(cleanSources([{ name: "本机命令", url: "https://workspace.local/" }])).toEqual([{ name: "本机命令", url: "" }]);
    expect(cleanSources([{ name: "本机命令 top / df" }])).toEqual([{ name: "本机命令 top / df", url: "" }]);
    expect(cleanSources([{ name: "CoinGecko", url: "https://api.coingecko.com/api/v3/simple/price" }])).toEqual([
      { name: "CoinGecko", url: "https://api.coingecko.com/api/v3/simple/price" },
    ]);
    expect(cleanSources([{ name: "", url: "javascript:alert(1)" }])).toEqual([]);
  });
});

function fakeStore(rows: Record<string, Record<string, unknown>>) {
  const now = () => new Date();
  const store = {
    async get(_owner: string, id: string) {
      return rows[id];
    },
    async list() {
      return Object.values(rows);
    },
    async claim(_owner: string, id: string) {
      const r = rows[id]!;
      if (r.leaseUntil && (r.leaseUntil as Date).getTime() > Date.now()) return false;
      r.leaseUntil = new Date(Date.now() + 60_000);
      return true;
    },
    async release(_owner: string, id: string) {
      rows[id]!.leaseUntil = null;
    },
    async update(_owner: string, id: string, input: { spec: string }) {
      Object.assign(rows[id]!, { spec: input.spec, error: null, refreshedAt: now(), updatedAt: now() });
      return rows[id];
    },
    async fail(_owner: string, id: string, reason: string) {
      Object.assign(rows[id]!, { error: reason, updatedAt: now() });
      return rows[id];
    },
    async defer(_owner: string, id: string, reason: string) {
      Object.assign(rows[id]!, { error: reason, updatedAt: now() });
      return rows[id];
    },
    async dueNowIfNoted(_owner: string, note: string) {
      return Object.values(rows).filter((r) => r.error === note);
    },
  };
  return store as unknown as LivePanelStore;
}

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  ownerUserId: "u",
  botId: "b",
  title: "服务器性能",
  status: "ready",
  spec: null,
  sources: [],
  instruction: "跑 top",
  refreshMinutes: 60,
  refreshAt: null,
  error: null,
  refreshedAt: null,
  leaseUntil: null,
  failures: 0,
  removed: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...extra,
});

describe("后台刷新的回合", () => {
  test("拿不到 panel_refresh / panel_create，也只能动正在刷新的那一张", async () => {
    const service = createLivePanelService({ store: fakeStore({ lp_a: row("lp_a"), lp_b: row("lp_b") }), runHeadless: async () => {}, log: () => {} });
    const names = service.tools("u", "b", { refreshOf: "lp_a" }).map((t) => t.name);
    expect(names).not.toContain("panel_refresh");
    expect(names).not.toContain("panel_create");
    expect(names).toContain("panel_update");
    const fail = service.tools("u", "b", { refreshOf: "lp_a" }).find((t) => t.name === "panel_fail")!;
    expect(String(await fail.execute({ id: "lp_b", reason: "x" }))).toContain("只能更新这一张");
    // 聊天里照常有 panel_refresh
    expect(service.tools("u", "b").map((t) => t.name)).toContain("panel_refresh");
  });
});

describe("交还计算机", () => {
  test("因为有人接管被推迟的面板，交还后马上重刷", async () => {
    const rows = { lp_a: row("lp_a", { error: CONTROL_HELD_NOTE, spec: "{}" }), lp_b: row("lp_b", { error: "别的错" }) };
    const ran: string[] = [];
    const service = createLivePanelService({
      store: fakeStore(rows),
      runHeadless: async ({ panelId }) => {
        ran.push(panelId);
      },
      log: () => {},
    });
    const off = onControlReleased((owner) => void service.resumeAfterHandback(owner));
    notifyControlReleased("u");
    await new Promise((r) => setTimeout(r, 20));
    off();
    expect(ran).toEqual(["lp_a"]);
  });
});
