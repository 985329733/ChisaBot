import {
  IconActivity,
  IconArrowRight,
  IconBrain,
  IconClock,
  IconExternalLink,
  IconNetwork,
  IconPlugConnected,
  IconServer,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { MagpieOverview } from "../../../../../../shared/model-selection";
import { ProviderMark } from "@/components/agents/model-picker";
import { PageSection, PageShell, PageSkeleton } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Card, CardBody, CardHeader, ErrorCard, ListRow, SettingRow, StatTile } from "@/components/ui/skyglass";
import { MAGPIE_CONSOLE_PATH, agoText, loadMagpieOverview, magpieKeys, magpieOverviewQueryOptions } from "@/lib/magpie";
import { loadModelCatalog } from "@/lib/model-selection/queries";
import { modelSelectionKeys } from "@/lib/model-selection/queries";
import { notifyModelSelectionChanged } from "@/lib/model-selection/sync";

export const Route = createFileRoute("/_authed/admin/magpie/")({
  component: MagpiePage,
});

const SYNC_FEEDBACK = { pending: "同步中…", success: "已同步", error: "同步失败" };

/**
 * 管理后台 → 模型平台 Magpie (template E). Status of the gateway every BOT's model goes through,
 * ChisaBot's connection to it, the model sync, and the entry to the embedded console.
 */
function MagpiePage() {
  const queryClient = useQueryClient();
  const overview = useQuery(magpieOverviewQueryOptions());

  async function refreshStatus() {
    const next = await loadMagpieOverview(true);
    queryClient.setQueryData(magpieKeys.overview, next);
    if (!next.reachable) throw new Error(next.error ?? "Magpie 不可访问");
  }
  async function syncModels() {
    const catalog = await loadModelCatalog(true);
    queryClient.setQueryData(modelSelectionKeys.catalog, catalog);
    void queryClient.invalidateQueries({ queryKey: modelSelectionKeys.agents });
    notifyModelSelectionChanged();
    queryClient.setQueryData(magpieKeys.overview, await loadMagpieOverview(false));
  }

  return (
    <PageShell
      action={
        <div className="flex items-center gap-2">
          <RefreshButton onRefresh={refreshStatus} size="sm" variant="outline">
            {"刷新状态"}
          </RefreshButton>
          <Button
            disabled={!overview.data?.managementAvailable}
            nativeButton={false}
            render={<Link to="/admin/magpie/console" />}
            size="sm"
          >
            <IconNetwork />
            {"打开 Magpie 管理"}
          </Button>
        </div>
      }
      description="所有机器人的模型都经由自托管的 Magpie 网关调用。这里查看网关状态与模型同步，并直接在后台里管理提供方和模型。"
      title="模型平台 Magpie"
    >
      {overview.isPending ? (
        <PageSkeleton rows={4} tall />
      ) : !overview.data ? (
        <ErrorCard
          action={
            <Button className="mt-2" onClick={() => void overview.refetch()} size="sm" type="button" variant="outline">
              {"重试"}
            </Button>
          }
          description={overview.error?.message ?? "无法读取 Magpie 状态。"}
          title="Magpie 状态暂时无法读取"
        />
      ) : (
        <Overview data={overview.data} onSync={syncModels} />
      )}
    </PageShell>
  );
}

function Overview({ data, onSync }: { data: MagpieOverview; onSync: () => Promise<void> }) {
  const enabled = data.providers.filter((provider) => provider.enabled);
  const ready = enabled.filter((provider) => provider.ready).length;
  const disabled = data.providers.length - enabled.length;
  const catalog = data.catalog;
  return (
    <>
      {!data.reachable ? (
        <ErrorCard
          className="mt-2"
          description={data.error ?? "无法连接 Magpie 管理接口。"}
          title="Magpie 当前不可访问"
        />
      ) : null}
      <div className="magpie-stats">
        <StatTile
          delta={data.gatewayOn === false ? "网关已关闭" : data.reachable ? `检查于 ${agoText(data.checkedAt)}` : undefined}
          icon={<IconActivity className="size-4" />}
          label="网关状态"
          tone={data.reachable ? "ok" : "danger"}
          value={data.reachable ? "运行中" : "不可访问"}
        />
        <StatTile
          delta={[data.version ? `Magpie ${data.version}` : "", disabled ? `另有 ${disabled} 个已停用` : ""].filter(Boolean).join(" · ") || undefined}
          icon={<IconServer className="size-4" />}
          label="就绪的提供方"
          tone={enabled.length && ready < enabled.length ? "warn" : undefined}
          value={data.reachable ? `${ready} / ${enabled.length}` : "—"}
        />
        <StatTile
          delta={catalog.source === "magpie" ? "来自 Magpie /v1/models" : catalog.count !== undefined ? "来自当前模型接口" : undefined}
          icon={<IconBrain className="size-4" />}
          label="可用模型"
          value={catalog.count ?? "—"}
        />
        <StatTile
          delta={catalog.autoRefreshMinutes ? `每 ${catalog.autoRefreshMinutes} 分钟自动同步` : "自动同步已关闭"}
          icon={<IconClock className="size-4" />}
          label="上次同步"
          tone={catalog.lastError ? "warn" : undefined}
          value={agoText(catalog.fetchedAt)}
        />
      </div>

      <PageSection
        action={
          <RefreshButton feedback={SYNC_FEEDBACK} onRefresh={onSync} size="sm" variant="outline">
            {"立即同步模型"}
          </RefreshButton>
        }
        description="ChisaBot 通过这个接口调用模型，并从它同步机器人可选的模型列表。"
        title="ChisaBot 接入"
      >
        <Card>
          <SettingRow
            description={data.connection?.viaMagpie ? "聊天、长期任务和面板的模型请求都经由 Magpie 转发。" : "当前模型接口不是 Magpie，可在模型设置中改为 http://magpie:3425/v1。"}
            title="模型网关"
          >
            <span className={data.connection?.viaMagpie ? "magpie-badge is-ok" : "magpie-badge is-warn"}>
              {data.connection?.viaMagpie ? "经由 Magpie" : "其他接口"}
            </span>
          </SettingRow>
          <SettingRow description={data.connection ? `${data.connection.protocol === "anthropic" ? "Anthropic 协议" : "OpenAI 兼容协议"} · ${data.connection.source === "saved" ? "设置中保存" : "环境变量"}` : undefined} title="接口地址">
            <code className="magpie-code">{data.connection?.baseUrl ?? "—"}</code>
          </SettingRow>
          <SettingRow description="没有单独选择模型的机器人使用它；每个机器人也可以在聊天输入框里切换。" title="部署默认模型">
            <code className="magpie-code">{data.connection?.defaultModel ?? "—"}</code>
          </SettingRow>
          <SettingRow
            description={catalog.lastError ? `上次同步失败：${catalog.lastError}` : "启动时、点「刷新」时和定时任务都会重新读取模型列表；网关暂时不可用时继续使用上次的列表。"}
            title="模型同步"
          >
            <span className={catalog.lastError ? "magpie-badge is-warn" : "magpie-badge is-ok"}>
              {catalog.lastError ? "同步异常" : `${agoText(catalog.fetchedAt)}同步`}
            </span>
          </SettingRow>
          <SettingRow description="更换协议、接口地址、默认模型或调用密钥（密钥只保存在服务器）。" title="模型设置">
            <Button nativeButton={false} render={<Link to="/admin/models" />} size="sm" variant="ghost">
              {"前往"}
              <IconArrowRight />
            </Button>
          </SettingRow>
        </Card>
      </PageSection>

      <PageSection
        description="在 Magpie 里添加的提供方与勾选的模型，会同步到机器人的模型选择器。"
        title="提供方"
      >
        {data.providers.length ? (
          <Card>
            {data.providers.map((provider) => (
              <ListRow
                actions={
                  <span className={!provider.enabled ? "magpie-badge" : provider.ready ? "magpie-badge is-ok" : "magpie-badge is-danger"}>
                    <span aria-hidden className={`model-health-dot ${!provider.enabled ? "is-off" : provider.ready ? "is-ok" : "is-bad"}`} />
                    {!provider.enabled ? "已停用" : provider.ready ? "就绪" : "未就绪"}
                  </span>
                }
                icon={<ProviderMark provider={provider.id} />}
                key={provider.id}
                sub={`${provider.id} · ${provider.models} 个模型开放给网关`}
                title={provider.name}
              />
            ))}
          </Card>
        ) : (
          <Card dashed className="magpie-empty">
            <p>{data.reachable ? "Magpie 里还没有提供方。打开 Magpie 管理添加一个。" : "Magpie 不可访问，暂时无法列出提供方。"}</p>
          </Card>
        )}
      </PageSection>

      <PageSection title="Magpie 管理">
        <Card interactive={data.managementAvailable}>
          <CardHeader
            action={
              data.managementAvailable ? (
                <div className="flex items-center gap-1">
                  <Button nativeButton={false} render={<a href={MAGPIE_CONSOLE_PATH} rel="noopener" target="_blank" />} size="sm" variant="ghost">
                    <IconExternalLink />
                    {"新窗口"}
                  </Button>
                  <Button nativeButton={false} render={<Link to="/admin/magpie/console" />} size="sm">
                    {"打开"}
                    <IconArrowRight />
                  </Button>
                </div>
              ) : undefined
            }
            description={
              data.managementAvailable
                ? "在设置内嵌打开 Magpie 控制台：提供方、模型、调用密钥、用量与路由。仅管理员可见，沿用 ChisaBot 登录，Magpie 密钥不会发送到浏览器。"
                : "此部署没有为 ChisaBot 配置 Magpie 管理密钥（MAGPIE_ADMIN_URL + MAGPIE_WEB_KEY_FILE），暂时无法内嵌。"
            }
            icon={<IconPlugConnected className="size-5" />}
            title="Magpie 控制台"
          />
          <CardBody />
        </Card>
      </PageSection>
    </>
  );
}
