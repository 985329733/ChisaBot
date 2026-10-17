import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ReactNode, useEffect, useState } from "react";
import { KeepAliveStage, type KeptState } from "@/components/layout/keep-alive";
import { settleReactWork } from "./settle-react-work";

/**
 * 切回机器人页总要「刷新一次」（2026-10-17，DESIGN.md §98）：聊天、设置、管理以前各有一个外壳，离开聊天 = 聊天卸载，
 * 回来 = 重新接入、回放、读历史（发送键闪成「停止」、气泡重排、右栏重载）。现在聊天由外壳留着：
 * 离开时只是藏起来，回来还是同一个实例。
 */

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost/" }));
afterEach(async () => {
  cleanup();
  await settleReactWork();
});
afterAll(async () => {
  await settleReactWork();
  GlobalRegistrator.unregister();
});

type Addr = { id: string };
const same = (a: Addr, b: Addr) => a.id === b.id;

function counterPage() {
  const log = { mounts: 0, unmounts: 0, states: [] as Array<{ id: string } & KeptState>, renders: 0 };
  function Page({ id, state }: { id: string; state: KeptState }) {
    const [instance] = useState(() => Math.random());
    log.renders++;
    log.states.push({ id, ...state });
    useEffect(() => {
      log.mounts++;
      return () => {
        log.unmounts++;
      };
    }, []);
    return <div data-instance={instance} data-testid="page">{id}</div>;
  }
  return { log, Page };
}

function stage(Page: (p: { id: string; state: KeptState }) => ReactNode, address: Addr | null, other?: string, idleVisible = false, ttlMs?: number) {
  return (
    <KeepAliveStage
      address={address}
      idleVisible={idleVisible}
      renderKept={(kept, state) => <Page id={kept.id} state={state} />}
      same={same}
      {...(ttlMs ? { ttlMs } : {})}
    >
      {other ? <section data-testid="other">{other}</section> : null}
    </KeepAliveStage>
  );
}

test("离开聊天再回来：同一个实例，不卸载、不重新挂载", async () => {
  const { log, Page } = counterPage();
  const view = render(stage(Page, { id: "c1" }));
  const instance = view.getByTestId("page").getAttribute("data-instance");
  expect(log.mounts).toBe(1);

  // 去设置：聊天藏起来（不可见、不可点、读屏跳过），设置盖在上面。
  view.rerender(stage(Page, null, "设置"));
  const kept = view.getByTestId("kept-page");
  expect(kept.getAttribute("data-visible")).toBe("false");
  expect(kept.hasAttribute("inert")).toBe(true);
  expect(kept.getAttribute("aria-hidden")).toBe("true");
  expect(kept.style.visibility).toBe("hidden");
  expect(view.getByTestId("route-layer").className).toContain("absolute");
  expect(view.getByTestId("other").textContent).toBe("设置");
  expect(log.states.at(-1)).toMatchObject({ id: "c1", visible: false });

  // 回来：还是那一个。
  view.rerender(stage(Page, { id: "c1" }));
  expect(log.mounts).toBe(1);
  expect(log.unmounts).toBe(0);
  expect(view.getByTestId("page").getAttribute("data-instance")).toBe(instance);
  expect(view.getByTestId("kept-page").getAttribute("data-visible")).toBe("true");
  expect(view.getByTestId("kept-page").hasAttribute("inert")).toBe(false);
  expect(view.getByTestId("route-layer").className).toContain("contents");
  // 回来一次，epoch 加一（聊天据此不把离开期间的地址变化当成用户操作）。
  expect(log.states.at(-1)).toMatchObject({ id: "c1", visible: true, epoch: 1 });
});

test("换一段对话：留着的换成新的那段（同一个位置，交给页面自己决定要不要重挂）", () => {
  const { log, Page } = counterPage();
  const view = render(stage(Page, { id: "c1" }));
  view.rerender(stage(Page, { id: "c2" }));
  expect(view.getByTestId("page").textContent).toBe("c2");
  expect(log.states.at(-1)).toMatchObject({ id: "c2", visible: true });
});

test("`/` 正在跳到聊天时，留着的聊天先露着（不空一下）", () => {
  const { log, Page } = counterPage();
  const view = render(stage(Page, { id: "c1" }));
  view.rerender(stage(Page, null, "设置"));
  view.rerender(stage(Page, null, undefined, true));
  expect(view.getByTestId("kept-page").getAttribute("data-visible")).toBe("true");
  expect(view.getByTestId("route-layer").className).toContain("contents");
  expect(log.mounts).toBe(1);
});

test("一开始就在别的页面：没有留着的聊天，路由照常画", () => {
  const { log, Page } = counterPage();
  const view = render(stage(Page, null, "设置"));
  expect(view.queryByTestId("kept-page")).toBeNull();
  expect(view.getByTestId("other").textContent).toBe("设置");
  expect(log.mounts).toBe(0);
});

test("路由那一层是同一个元素：聊天留不留着，别的页面都不会重新挂载", () => {
  function Other() {
    const [instance] = useState(() => Math.random());
    return <i data-instance={instance} data-testid="o" />;
  }
  const make = (address: Addr | null) => (
    <KeepAliveStage address={address} renderKept={(k) => <b>{k.id}</b>} same={same} ttlMs={20}>
      <Other />
    </KeepAliveStage>
  );
  const view = render(make({ id: "c1" }));
  const first = view.getByTestId("o").getAttribute("data-instance");
  view.rerender(make(null));
  view.rerender(make({ id: "c1" }));
  expect(view.getByTestId("o").getAttribute("data-instance")).toBe(first);
});

test("藏够时间就放掉（不再一直问服务器）", async () => {
  const { log, Page } = counterPage();
  const view = render(stage(Page, { id: "c1" }));
  view.rerender(stage(Page, null, "设置", false, 30));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
  expect(view.queryByTestId("kept-page")).toBeNull();
  expect(log.unmounts).toBe(1);
});

test("接线：聊天路由自己不画东西，外壳只有一个，设置 / 管理不再各画一个外壳", () => {
  const src = (p: string) => readFileSync(join(import.meta.dir, "../src", p), "utf8");
  expect(src("routes/_authed/_app/channel/$channelId.tsx")).toContain("component: () => null");
  expect(src("routes/_authed.tsx")).toContain("<AuthedShell />");
  for (const file of ["routes/_authed/_app.tsx", "routes/_authed/settings/route.tsx", "routes/_authed/admin/route.tsx"]) {
    expect(src(file)).not.toContain("<GlassShell");
  }
  const shell = src("components/layout/authed-shell.tsx");
  expect(shell).toContain("<KeepAliveStage");
  // 右栏在设置里藏起来，不卸载；data-mode 不随设置变（否则回聊天时主区淡入重播）。
  expect(shell).toContain("rightHidden=");
  expect(shell).toContain("mode={switched ? mode : undefined}");
  // 藏着的聊天不改地址、不标已读、不登记左栏「⋯」。
  const page = src("components/channels/channel-page.tsx");
  expect(page).toContain("if (!visibleRef.current) return;");
  expect(page).toContain("if (unseen && visible)");
  expect(page).toContain("{visible ? <RegisterBotChat");
});
