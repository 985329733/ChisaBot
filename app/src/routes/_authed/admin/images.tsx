import { IconPhoto } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { IMAGE_PROVIDER_PRESETS, type ImageProviderKind, type ImageSettingsView } from "../../../../../shared/chat-files";
import { PageShell, PageSkeleton } from "@/components/layout/page-shell";
import { useAsyncAction } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, ErrorCard, SettingRow } from "@/components/ui/skyglass";
import { Switch } from "@/components/ui/switch";
import { chatFileKeys, imageSettingsQueryOptions, saveImageSettings, testImageSettings } from "@/lib/chat-files";

export const Route = createFileRoute("/_authed/admin/images")({
  component: ImageSettingsPage,
});

/** 设置 → 图片生成（DESIGN.md §56）：机器人 image_generate / image_edit 用的模型。默认关闭。 */
function ImageSettingsPage() {
  const settings = useQuery(imageSettingsQueryOptions());
  return (
    <PageShell
      description="机器人画图、改图时调用的模型。打开后每个机器人都能用 image_generate / image_edit，结果直接显示在聊天里、存进它的工作区。每张图都会按模型价格计费。"
      title="图片生成"
    >
      {settings.isPending ? (
        <PageSkeleton rows={4} />
      ) : settings.error || !settings.data ? (
        <ErrorCard action={<Button onClick={() => settings.refetch()} variant="outline">{"重试"}</Button>} title={settings.error?.message ?? "无法加载图片设置"} />
      ) : (
        <ImageSettingsForm current={settings.data} />
      )}
    </PageShell>
  );
}

function ImageSettingsForm({ current }: { current: ImageSettingsView }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    enabled: current.enabled,
    provider: current.provider,
    baseUrl: current.baseUrl,
    model: current.model,
    editModel: current.editModel,
    apiKey: "",
  });
  const [probe, setProbe] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => setProbe(null), [form.provider, form.baseUrl, form.model, form.apiKey]);
  const preset = IMAGE_PROVIDER_PRESETS[form.provider];
  const keyNote =
    form.apiKey.trim() !== ""
      ? "保存后替换已存的密钥。"
      : current.keySource === "saved"
        ? `已保存${current.keyHint ? `（末四位 ${current.keyHint}）` : ""}，留空不改。`
        : current.keySource === "environment"
          ? `沿用部署环境变量里的密钥${current.keyHint ? `（末四位 ${current.keyHint}）` : ""}。`
          : form.provider === "minimax"
            ? "没有密钥：填一个，或在部署环境变量里配置 MINIMAX_API_KEY。"
            : "没有密钥：填一个，或在部署环境变量里配置 IMAGE_API_KEY。";
  const valid = /^https?:\/\/\S+$/.test(form.baseUrl.trim()) && form.model.trim() !== "";
  const save = useAsyncAction(
    async () => {
      await saveImageSettings({
        enabled: form.enabled,
        provider: form.provider,
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
        editModel: form.editModel.trim(),
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      });
      setForm((f) => ({ ...f, apiKey: "" }));
      await queryClient.invalidateQueries({ queryKey: chatFileKeys.imageSettings });
    },
    { errorToast: (error) => error.message },
  );
  const test = useAsyncAction(
    async () => {
      const result = await testImageSettings({
        provider: form.provider,
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      });
      setProbe(result);
      if (!result.ok) throw new Error(result.message);
    },
    { errorToast: false },
  );
  function pickProvider(provider: ImageProviderKind) {
    const next = IMAGE_PROVIDER_PRESETS[provider];
    setForm((f) => ({
      ...f,
      provider,
      // 换了接口类型：地址和模型换成这一类的默认值（用户改过的同类值保留）。
      baseUrl: f.provider === provider ? f.baseUrl : next.baseUrl,
      model: f.provider === provider ? f.model : next.model,
      editModel: f.provider === provider ? f.editModel : "",
    }));
  }
  return (
    <form
      autoComplete="off"
      className="mt-6 flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && save.state !== "pending") void save.run();
      }}
    >
      <Card>
        <SettingRow
          description={current.ready ? "已打开：机器人现在可以画图、改图。" : form.enabled ? "保存后打开。" : "关闭时机器人不会拿到画图工具，会告诉用户请管理员打开。"}
          title={
            <span className="inline-flex items-center gap-2">
              <IconPhoto className="size-4" />
              {"允许机器人生成图片"}
            </span>
          }
        >
          <Switch aria-label="允许机器人生成图片" checked={form.enabled} data-testid="image-enabled" onCheckedChange={(enabled) => setForm((f) => ({ ...f, enabled }))} />
        </SettingRow>
      </Card>
      <Card className="img-settings">
        <div className="im-form">
          <label className="im-field" htmlFor="img-provider">
            <span className="im-field-l">{"接口类型"}</span>
            <Select onValueChange={(value) => pickProvider(value as ImageProviderKind)} value={form.provider}>
              <SelectTrigger className="w-full" id="img-provider">
                <SelectValue>{preset.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(IMAGE_PROVIDER_PRESETS) as ImageProviderKind[]).map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {IMAGE_PROVIDER_PRESETS[kind].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="im-field-h">{preset.editNote}</span>
          </label>
          <label className="im-field" htmlFor="img-base">
            <span className="im-field-l">{"接口地址"}</span>
            <Input className="font-mono" id="img-base" onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder={preset.baseUrl} value={form.baseUrl} />
          </label>
          <div className="im-grid">
            <label className="im-field" htmlFor="img-model">
              <span className="im-field-l">{"生成模型"}</span>
              <Input className="font-mono" id="img-model" onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder={preset.model} value={form.model} />
            </label>
            <label className="im-field" htmlFor="img-edit-model">
              <span className="im-field-l">
                {"修改模型"}
                <span className="im-req">{"留空 = 同生成模型"}</span>
              </span>
              <Input className="font-mono" id="img-edit-model" onChange={(e) => setForm({ ...form, editModel: e.target.value })} placeholder={form.model || preset.model} value={form.editModel} />
            </label>
          </div>
          <label className="im-field" htmlFor="img-key">
            <span className="im-field-l">{"API 密钥"}</span>
            <Input
              autoComplete="new-password"
              className="font-mono"
              data-1p-ignore
              id="img-key"
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder={current.keySource === "none" ? "粘贴密钥" : "留空不改"}
              type="password"
              value={form.apiKey}
            />
            <span className="im-field-h">{keyNote}</span>
          </label>
          {probe ? (
            <p className={probe.ok ? "img-probe is-ok" : "img-probe is-bad"} data-testid="image-probe" role="status">
              {probe.message}
            </p>
          ) : null}
        </div>
      </Card>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button disabled={!valid} feedback="test" onClick={() => void test.run()} state={test.state} type="button" variant="outline">
          {"检查（不生成图片）"}
        </Button>
        <Button data-testid="image-save" disabled={!valid} feedback="save" state={save.state} type="submit">
          {"保存"}
        </Button>
      </div>
    </form>
  );
}
