import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import type { ModelSettingsCurrent } from "@/lib/model-settings/form";
import { Route as ModelsRoute } from "@/routes/_authed/admin/models";

beforeAll(() => GlobalRegistrator.register());
afterEach(async () => {
  await act(async () => cleanup());
});
afterAll(() => GlobalRegistrator.unregister());

const originalFetch = globalThis.fetch;
let stored: ModelSettingsCurrent;
let writes: { path: string; body: Record<string, unknown> }[];
let connectionOK: boolean;
let loadError: boolean;
let saveError: boolean;

beforeEach(() => {
  stored = {
    provider: "openai",
    model: "original-model",
    baseUrl: "https://models.example.test/v1",
    useApiKey: true,
    hasApiKey: true,
    source: "environment",
  };
  writes = [];
  connectionOK = true;
  loadError = false;
  saveError = false;
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/admin/model-settings" && !init?.method) {
        return loadError
          ? Response.json({ error: "当前无法读取模型设置。" }, { status: 500 })
          : Response.json({ config: stored });
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      writes.push({ path, body });
      if (path === "/api/admin/model-settings/test") {
        return Response.json({
          ok: connectionOK,
          message: connectionOK ? "模型连接成功。" : "模型接口拒绝了请求。",
          latencyMs: 125,
        });
      }
      if (path === "/api/admin/model-settings" && init?.method === "PUT") {
        if (saveError)
          return Response.json(
            { error: "模型设置保存失败，请重试。" },
            { status: 500 },
          );
        stored = {
          provider: body.provider as ModelSettingsCurrent["provider"],
          model: String(body.model),
          baseUrl: String(body.baseUrl),
          useApiKey: Boolean(body.useApiKey),
          hasApiKey: Boolean(body.useApiKey),
          source: "saved",
        };
        return Response.json({ config: stored });
      }
      throw new Error(`Unexpected model settings request: ${path}`);
    },
    { preconnect: originalFetch.preconnect },
  );
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function draw() {
  const Models = ModelsRoute.options.component as ComponentType;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: createRootRoute({ component: () => <Models /> }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

async function fill(
  view: ReturnType<typeof draw>,
  label: string,
  value: string,
) {
  const field = await view.findByLabelText(label);
  const user = userEvent.setup({ document: view.baseElement.ownerDocument });
  await user.clear(field);
  await user.type(field, value);
}

test("saving a new model preserves the key by omitting a blank password field", async () => {
  const view = draw();
  await view.findByLabelText("模型名称");
  expect((view.getByLabelText("API Key") as HTMLInputElement).value).toBe("");
  await fill(view, "模型名称", "next-model");
  fireEvent.click(view.getByRole("button", { name: "保存设置" }));
  await view.findByText(/已保存，下一轮对话将使用/);
  expect(writes).toEqual([
    {
      path: "/api/admin/model-settings",
      body: {
        provider: "openai",
        model: "next-model",
        baseUrl: "https://models.example.test/v1",
        useApiKey: true,
      },
    },
  ]);
});

test("testing uses the unsaved form and editing clears its stale result", async () => {
  const view = draw();
  await fill(view, "模型名称", "draft-model");
  fireEvent.click(view.getByRole("button", { name: "测试连接" }));
  await view.findByText(/模型连接成功/);
  expect(writes[0]).toMatchObject({
    path: "/api/admin/model-settings/test",
    body: { model: "draft-model" },
  });
  expect(stored.model).toBe("original-model");
  await fill(view, "模型名称", "different-model");
  expect(view.queryByText(/模型连接成功/)).toBeNull();
});

test("switching interfaces requires a fresh key and clears it after a successful save", async () => {
  const view = draw();
  await fill(view, "接口地址（Base URL）", "https://other.example.test/v1");
  fireEvent.click(view.getByRole("button", { name: "保存设置" }));
  await view.findByText(/请为此接口填写 API Key/);
  expect(writes).toHaveLength(0);
  await fill(view, "API Key", "new-key");
  fireEvent.click(view.getByRole("button", { name: "保存设置" }));
  await view.findByText(/已保存，下一轮对话将使用/);
  expect(writes[0]?.body.apiKey).toBe("new-key");
  expect((view.getByLabelText("API Key") as HTMLInputElement).value).toBe("");
  expect(view.container.textContent).not.toContain("new-key");
});

test("an administrator can explicitly use a local model with no API key", async () => {
  const view = draw();
  await fill(view, "接口地址（Base URL）", "http://localhost:11434/v1");
  fireEvent.click(view.getByRole("checkbox", { name: "此接口需要 API Key" }));
  fireEvent.click(view.getByRole("button", { name: "保存设置" }));
  await view.findByText(/已保存，下一轮对话将使用/);
  expect(writes[0]?.body).toMatchObject({ useApiKey: false });
  expect(writes[0]?.body.apiKey).toBeUndefined();
});

test("connection failure remains a visible result instead of looking successful", async () => {
  connectionOK = false;
  const view = draw();
  await view.findByLabelText("模型名称");
  fireEvent.click(view.getByRole("button", { name: "测试连接" }));
  await view.findByRole("alert");
  expect(view.getByRole("alert").textContent).toContain("模型接口拒绝了请求。");
  expect(writes).toHaveLength(1);
});

test("failed settings reads show the reason and provide retry", async () => {
  loadError = true;
  const view = draw();
  expect((await view.findByRole("alert")).textContent).toContain(
    "当前无法读取模型设置",
  );
  loadError = false;
  fireEvent.click(view.getByRole("button", { name: "重试" }));
  await waitFor(() => expect(view.queryByLabelText("模型名称")).not.toBeNull());
});

test("failed saves keep the draft available and allow a retry", async () => {
  saveError = true;
  const view = draw();
  await fill(view, "模型名称", "retry-model");
  fireEvent.click(view.getByRole("button", { name: "保存设置" }));
  expect((await view.findByRole("alert")).textContent).toContain(
    "模型设置保存失败",
  );
  expect((view.getByLabelText("模型名称") as HTMLInputElement).value).toBe(
    "retry-model",
  );
  saveError = false;
  fireEvent.click(view.getByRole("button", { name: "保存设置" }));
  await view.findByText(/已保存，下一轮对话将使用/);
  expect(stored.model).toBe("retry-model");
});
