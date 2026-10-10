import { IconCheck, IconLoader2 } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageSection, PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type ModelSettingsCurrent,
  type ModelSettingsDraft,
  type ModelSettingsErrors,
  modelSettingsInput,
  modelSettingsValidation,
} from "@/lib/model-settings/form";
import {
  saveModelSettingsMutationOptions,
  testModelConnectionMutationOptions,
} from "@/lib/model-settings/mutations";
import { modelSettingsQueryOptions } from "@/lib/model-settings/queries";

export const Route = createFileRoute("/_authed/admin/models")({
  component: ModelSettingsPage,
});

function ModelSettingsPage() {
  const settings = useQuery(modelSettingsQueryOptions());
  return (
    <PageShell
      description="配置聊天使用的模型和接口。保存后从下一轮对话开始使用，无需重启。"
      title="模型设置"
    >
      {settings.isPending ? (
        <p className="mt-8 text-muted-foreground text-sm" role="status">
          正在加载模型设置…
        </p>
      ) : settings.error || !settings.data ? (
        <div className="mt-8 space-y-3">
          <p className="text-destructive text-sm" role="alert">
            {settings.error?.message ?? "无法加载模型设置。"}
          </p>
          <Button
            disabled={settings.isFetching}
            onClick={() => settings.refetch()}
            type="button"
            variant="outline"
          >
            重试
          </Button>
        </div>
      ) : (
        <ModelSettingsForm config={settings.data} />
      )}
    </PageShell>
  );
}

function ModelSettingsForm({ config }: { config: ModelSettingsCurrent }) {
  const queryClient = useQueryClient();
  const save = useMutation(saveModelSettingsMutationOptions(queryClient));
  const testConnection = useMutation(testModelConnectionMutationOptions());
  const [current, setCurrent] = useState(config);
  const [draft, setDraft] = useState<ModelSettingsDraft>(() => ({
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    useApiKey: config.useApiKey,
    apiKey: "",
  }));
  const [errors, setErrors] = useState<ModelSettingsErrors>({});
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const busy = save.isPending || testConnection.isPending;

  function change<Key extends keyof ModelSettingsDraft>(
    key: Key,
    value: ModelSettingsDraft[Key],
  ) {
    setDraft((previous) => ({
      ...previous,
      [key]: value,
      ...(key === "useApiKey" && !value ? { apiKey: "" } : {}),
    }));
    setErrors({});
    setFeedback(null);
  }

  async function submit(action: "save" | "test") {
    if (busy) return;
    const validation = modelSettingsValidation(draft, current);
    setErrors(validation);
    setFeedback(null);
    if (Object.keys(validation).length) return;
    const input = modelSettingsInput(draft);
    try {
      if (action === "test") {
        const result = await testConnection.mutateAsync(input);
        setFeedback({
          ok: result.ok,
          message: `${result.message}${result.ok ? `（${Math.round(result.latencyMs)} 毫秒）` : ""}`,
        });
      } else {
        const saved = await save.mutateAsync(input);
        setCurrent(saved);
        setDraft({
          provider: saved.provider,
          model: saved.model,
          baseUrl: saved.baseUrl,
          useApiKey: saved.useApiKey,
          apiKey: "",
        });
        setFeedback({
          ok: true,
          message: "已保存，下一轮对话将使用新的模型设置。",
        });
      }
    } catch (error) {
      setFeedback({
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : action === "save"
              ? "无法保存模型设置。"
              : "无法测试模型连接。",
      });
    } finally {
      // Mutation variables contain a write-only key; release them after the request.
      save.reset();
      testConnection.reset();
    }
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-b pb-5 text-muted-foreground text-sm">
        <span>
          {current.source === "saved" ? "已保存网页配置" : "正在使用部署配置"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          {current.useApiKey && current.hasApiKey ? (
            <>
              <IconCheck className="size-4" />
              API Key 已配置
            </>
          ) : current.useApiKey ? (
            "API Key 未配置"
          ) : (
            "此接口无需 API Key"
          )}
        </span>
      </div>
      <PageSection title="聊天模型">
        <form
          className="mt-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit("save");
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="model-provider">接口协议</FieldLabel>
              <Select
                disabled={busy}
                onValueChange={(value) =>
                  change("provider", value as ModelSettingsDraft["provider"])
                }
                value={draft.provider}
              >
                <SelectTrigger id="model-provider">
                  <SelectValue>
                    {draft.provider === "openai" ? "OpenAI 兼容" : "Anthropic"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI 兼容</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>
                MiniMax、DeepSeek、Ollama 等兼容接口选择 OpenAI 兼容。
              </FieldDescription>
            </Field>
            <Field data-invalid={Boolean(errors.model)}>
              <FieldLabel htmlFor="model-name">模型名称</FieldLabel>
              <Input
                aria-describedby="model-name-help"
                aria-invalid={Boolean(errors.model)}
                autoComplete="off"
                disabled={busy}
                id="model-name"
                onChange={(event) => change("model", event.target.value)}
                placeholder="例如 MiniMax-M3.1-Flash-Preview"
                spellCheck={false}
                value={draft.model}
              />
              <FieldDescription id="model-name-help">
                填写接口支持的完整模型 ID。
              </FieldDescription>
              <FieldError>{errors.model}</FieldError>
            </Field>
            <Field data-invalid={Boolean(errors.baseUrl)}>
              <FieldLabel htmlFor="model-base-url">
                接口地址（Base URL）
              </FieldLabel>
              <Input
                aria-describedby="model-base-url-help"
                aria-invalid={Boolean(errors.baseUrl)}
                autoComplete="off"
                disabled={busy}
                id="model-base-url"
                inputMode="url"
                onChange={(event) => change("baseUrl", event.target.value)}
                placeholder={
                  draft.provider === "openai"
                    ? "https://api.minimax.cn/v1"
                    : "https://api.anthropic.com/v1"
                }
                spellCheck={false}
                value={draft.baseUrl}
              />
              <FieldDescription id="model-base-url-help">
                通常以 /v1 结尾，不包含 /chat/completions 或
                /messages。仅填写域名时会自动补上 /v1。Step Plan
                可直接填写官方的 /step_plan 地址，会自动补齐 /v1。
              </FieldDescription>
              <FieldError>{errors.baseUrl}</FieldError>
            </Field>
            <Field>
              <FieldLabel
                className="cursor-pointer"
                htmlFor="model-use-api-key"
              >
                <input
                  checked={draft.useApiKey}
                  className="size-4 accent-primary"
                  disabled={busy}
                  id="model-use-api-key"
                  onChange={(event) =>
                    change("useApiKey", event.target.checked)
                  }
                  type="checkbox"
                />
                此接口需要 API Key
              </FieldLabel>
              <FieldDescription>
                无需鉴权的自建模型接口可以关闭此项。
              </FieldDescription>
            </Field>
            {draft.useApiKey ? (
              <Field data-invalid={Boolean(errors.apiKey)}>
                <FieldLabel htmlFor="model-api-key">API Key</FieldLabel>
                <Input
                  aria-describedby="model-api-key-help"
                  aria-invalid={Boolean(errors.apiKey)}
                  autoComplete="new-password"
                  disabled={busy}
                  id="model-api-key"
                  onChange={(event) => change("apiKey", event.target.value)}
                  placeholder={
                    current.hasApiKey
                      ? "留空保留当前密钥"
                      : "填写此接口的 API Key"
                  }
                  spellCheck={false}
                  type="password"
                  value={draft.apiKey}
                />
                <FieldDescription id="model-api-key-help">
                  密钥加密保存，保存后不再显示。更换协议或接口地址时请填写新密钥。
                </FieldDescription>
                <FieldError>{errors.apiKey}</FieldError>
              </Field>
            ) : null}
          </FieldGroup>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button disabled={busy} type="submit">
              {save.isPending ? <IconLoader2 className="animate-spin" /> : null}
              {save.isPending ? "正在保存…" : "保存设置"}
            </Button>
            <Button
              disabled={busy}
              onClick={() => void submit("test")}
              type="button"
              variant="outline"
            >
              {testConnection.isPending ? (
                <IconLoader2 className="animate-spin" />
              ) : null}
              {testConnection.isPending ? "正在测试…" : "测试连接"}
            </Button>
          </div>
          <p className="mt-3 text-muted-foreground text-sm">
            测试当前填写的配置，不会保存设置；测试会发送一条简短请求。
          </p>
          {feedback ? (
            <p
              className={`mt-4 text-sm ${feedback.ok ? "text-foreground" : "text-destructive"}`}
              role={feedback.ok ? "status" : "alert"}
            >
              {feedback.message}
            </p>
          ) : null}
        </form>
      </PageSection>
    </>
  );
}
