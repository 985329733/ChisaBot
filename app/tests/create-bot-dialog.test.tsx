import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { CreateAgentDialog } from "@/components/agents/create-agent-dialog";

/**
 * 新建机器人（DESIGN.md §45.2）：一步完成；名称 / 职责 / 提示词从空白开始、没有示例角色；
 * 没有「谁可以看到它」「它在哪里运行」；发出去的一律私有、不带端点。
 */

beforeAll(() => GlobalRegistrator.register());
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const originalFetch = global.fetch;
let writes: { request: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  writes = [];
  global.fetch = Object.assign(
    async (path: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      if (method !== "GET") writes.push({ request: `${method} ${path}`, body });
      if (path === "/api/agents" && method === "POST") {
        return Response.json(
          {
            agent: {
              id: "new-bot",
              name: body.name,
              title: body.title,
              roleDescription: body.roleDescription,
              avatarSeed: "new-bot",
              visibility: "private",
              endpoint: null,
              builtIn: true,
              hasAuth: false,
              hasCallbackToken: false,
              hidden: false,
              pinned: false,
              systemOwned: false,
              canManage: true,
              mine: true,
            },
          },
          { status: 201 },
        );
      }
      return Response.json({ agents: [] });
    },
    { preconnect: originalFetch.preconnect },
  );
});

afterEach(() => {
  global.fetch = originalFetch;
});

function draw(screen: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: createRootRoute({ component: () => screen }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

test("one step, empty fields, no preset roles, no visibility or location choice", async () => {
  const view = draw(<CreateAgentDialog onClose={() => {}} onCreated={() => {}} open />);
  const name = (await view.findByLabelText("名称")) as HTMLInputElement;
  const title = view.getByLabelText("职责") as HTMLInputElement;
  const prompt = view.getByLabelText("提示词") as HTMLTextAreaElement;
  expect(name.value).toBe("");
  expect(title.value).toBe("");
  expect(prompt.value).toBe("");
  const text = document.body.textContent ?? "";
  for (const gone of ["财务", "报销", "发票", "第 1 步", "谁可以看到", "公开", "在哪里运行", "自托管", "内置", "端点"]) {
    expect(text.includes(gone)).toBe(false);
    for (const field of [name, title, prompt]) expect(field.placeholder.includes(gone)).toBe(false);
  }
  expect(view.queryByRole("radio")).toBeNull();
  expect(view.getByRole("button", { name: /创建机器人/ })).toBeTruthy();
});

test("creates a private, server-side bot from what the user wrote", async () => {
  const created: string[] = [];
  const view = draw(
    <CreateAgentDialog onClose={() => {}} onCreated={(id) => { created.push(id); }} open />,
  );
  const user = userEvent.setup({ document });
  await user.type(await view.findByLabelText("名称"), "测试");
  await user.type(view.getByLabelText("职责"), "试一下");
  await user.type(view.getByLabelText("提示词"), "你是我自己写的提示词。");
  await act(async () => {
    await user.click(view.getByRole("button", { name: /创建机器人/ }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(writes.map((w) => w.request)).toEqual(["POST /api/agents"]);
  expect(writes[0]?.body).toMatchObject({
    name: "测试",
    title: "试一下",
    roleDescription: "你是我自己写的提示词。",
    visibility: "private",
    endpoint: "",
  });
  expect(writes[0]?.body.auth).toBeUndefined();
  expect(created).toEqual(["new-bot"]);
});

test("empty submit shows field errors and sends nothing", async () => {
  const view = draw(<CreateAgentDialog onClose={() => {}} onCreated={() => {}} open />);
  const user = userEvent.setup({ document });
  await view.findByLabelText("名称");
  await act(async () => {
    await user.click(view.getByRole("button", { name: /创建机器人/ }));
  });
  expect(writes).toEqual([]);
  expect(view.getByText("请填写名称。")).toBeTruthy();
});
