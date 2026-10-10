import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { CopilotChatConfigurationProvider } from "@copilotkit/react-core/v2";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { BotModelInput } from "@/components/agents/bot-model-input";
import { saveAgentModelMutationOptions } from "@/lib/model-selection/mutations";
import { settleReactWork } from "./settle-react-work";

beforeAll(() => GlobalRegistrator.register({ url: "https://openbot.test/" }));
afterEach(cleanup);
afterAll(async () => { await settleReactWork(); GlobalRegistrator.unregister(); });
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("the SDK input retains typing and blocks click and Enter during a model save", async () => {
  let finishSave!: () => void;
  let sent = 0;
  const state = { agentId: "bot-a", model: "vendor/first", overrideModel: "vendor/first", defaultModel: "vendor/first", available: true, canManage: true };
  globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(input) === "/api/models") return Response.json({ fetchedAt: 10, models: [{ id: "vendor/first", label: "First", provider: "Vendor" }, { id: "other/second", label: "Second", provider: "Other" }] });
    if (String(input) === "/api/agents/bot-a/model") {
      if (init?.method === "PUT") await new Promise<void>((resolve) => { finishSave = resolve; });
      return Response.json(init?.method === "PUT" ? { ...state, model: "other/second", overrideModel: "other/second" } : state);
    }
    throw new Error(`Unexpected SDK model request: ${String(input)}`);
  }, { preconnect: originalFetch.preconnect });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Input() {
    const [draft, setDraft] = useState("keep these words");
    return <BotModelInput value={draft} onChange={setDraft} onSubmitMessage={() => { sent += 1; }} />;
  }
  const view = render(<QueryClientProvider client={queryClient}><CopilotChatConfigurationProvider agentId="bot-a"><Input /></CopilotChatConfigurationProvider></QueryClientProvider>);
  await view.findByRole("combobox", { name: "模型选择" });
  let save!: Promise<unknown>;
  await act(async () => { save = queryClient.getMutationCache().build(queryClient, saveAgentModelMutationOptions(queryClient, "bot-a")).execute("other/second"); });
  await waitFor(() => expect(finishSave).toBeDefined());
  const editor = view.container.querySelector("textarea")!;
  const send = view.getByRole("button", { name: "发送消息" }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  expect(editor.disabled).toBe(false);
  await act(async () => {
    fireEvent.keyDown(editor, { key: "Enter", code: "Enter" });
    fireEvent.click(send);
    fireEvent.change(editor, { target: { value: "keep these words and keep typing" } });
  });
  expect(sent).toBe(0);
  expect(editor.value).toBe("keep these words and keep typing");
  await act(async () => { finishSave(); await save; });
  await waitFor(() => expect(send.disabled).toBe(false));
  await act(async () => fireEvent.click(send));
  expect(sent).toBe(1);
  view.unmount();
  queryClient.clear();
});
