import {
  IconChartBar,
  IconChevronRight,
  IconDeviceDesktop,
  IconFingerprint,
  IconKey,
  IconNetwork,
  IconPlug,
  IconShieldLock,
  IconTerminal2,
  IconToggleRight,
  IconUsersGroup,
  IconWorld,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  PageEmpty,
  PageRows,
  PageSection,
  PageShell, PageSkeleton } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  removeNetworkPolicyMutationOptions,
  setCapabilityMutationOptions,
  setEnterpriseSettingMutationOptions,
  setNetworkPolicyMutationOptions,
  terminateInactiveComputersMutationOptions,
} from "@/lib/enterprise/mutations";
import {
  actionRecordsQueryOptions,
  type CapabilitySetting,
  type EgressRule,
  type EnterpriseOverview,
  enterpriseOverviewQueryOptions,
  modelUsageQueryOptions,
  type NetworkMode,
  type NetworkPolicy,
} from "@/lib/enterprise/queries";
import { queryClient } from "@/query-client";

export const Route = createFileRoute("/_authed/admin/enterprise")({
  component: EnterprisePage,
});

const MODE_NAMES: Record<NetworkMode, string> = {
  allow_all: "允许所有网络访问",
  defaults_plus_allowlist: "默认规则加团队允许列表",
  allowlist_only: "仅团队允许列表",
};

/** One rule per line: `example.com`, `*.corp.example`, or `10.0.0.0/8 443,8443`. */
function rulesFromText(text: string): EgressRule[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [value = "", ports] = line.split(/\s+/, 2);
      return /^[\d.:a-fA-F]+(\/\d+)?$/.test(value) &&
        /[\d]/.test(value) &&
        /[.:]/.test(value)
        ? { type: "cidr" as const, value, ...(ports ? { ports } : {}) }
        : { type: "domain" as const, value };
    });
}

function rulesToText(rules: EgressRule[]): string {
  return rules
    .map((rule) =>
      rule.type === "domain"
        ? rule.value
        : `${rule.value}${rule.ports ? ` ${rule.ports}` : ""}`,
    )
    .join("\n");
}

function summarizePolicy(policy: NetworkPolicy | undefined): string {
  if (!policy) return "未设置网络规则：机器人计算机可访问集群允许的地址";
  const count = policy.rules.length;
  return `${MODE_NAMES[policy.mode]} · ${count} 条规则${policy.locked ? " · 已锁定" : ""}`;
}

function EnterprisePage() {
  const overview = useQuery(enterpriseOverviewQueryOptions());
  const setCapability = useMutation(setCapabilityMutationOptions(queryClient));
  const setSetting = useMutation(
    setEnterpriseSettingMutationOptions(queryClient),
  );
  const failure = setCapability.error ?? setSetting.error;

  return (
    <PageShell
      description={
        "成员可以使用什么，机器人计算机如何连接网络，以及关于它的记录。每次更改都在审计轨迹上。"
      }
      title={"企业控制"}
    >
      {failure ? (
        <p className="mt-4 text-destructive text-sm" role="alert">
          {failure.message}
        </p>
      ) : null}
      {overview.isPending ? <PageSkeleton /> : overview.error ? (
        <p className="mt-4 text-destructive text-sm" role="alert">
          {"无法加载企业控制。"}
        </p>
      ) : (
        <EnterpriseSections
          data={overview.data}
          onCapability={(capability, allowed) =>
            setCapability.mutate({
              scopeKind: "organization",
              scopeId: "",
              capability,
              allowed,
            })
          }
          onSetting={(key, value) => setSetting.mutate({ key, value })}
          saving={setCapability.isPending || setSetting.isPending}
        />
      )}
    </PageShell>
  );
}

function EnterpriseSections({
  data,
  onCapability,
  onSetting,
  saving,
}: {
  data: EnterpriseOverview;
  onCapability: (
    capability: CapabilitySetting["capability"],
    allowed: boolean,
  ) => void;
  onSetting: (
    key: keyof EnterpriseOverview["settings"],
    value: unknown,
  ) => void;
  saving: boolean;
}) {
  const [overridesOpen, setOverridesOpen] = useState(false);
  const [networkScope, setNetworkScope] = useState<
    { scopeKind: "organization" | "group"; scopeId: string } | undefined
  >();
  const [modelsOpen, setModelsOpen] = useState(false);
  const [daysOpen, setDaysOpen] = useState(false);
  const { settings } = data;
  const overrideCount = data.capabilities.reduce(
    (count, capability) =>
      count +
      Object.keys(capability.roles).length +
      Object.keys(capability.groups).length,
    0,
  );
  const organizationPolicy = data.network.find(
    (row) => row.scopeKind === "organization",
  );
  const groupPolicies = data.network.filter((row) => row.scopeKind === "group");

  return (
    <>
      <PageSection
        description={
          "社交登录对 INITIAL_ADMIN_EMAILS 中的地址保持可用，作为 break-glass 方式，并且每次此类登录都会被审计。"
        }
        title={"登录"}
      >
        <PageRows>
          <Item size="sm">
            <ItemMedia variant="icon">
              <IconShieldLock />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{"要求 SSO"}</ItemTitle>
              <ItemDescription>
                {settings.ssoRequired
                  ? "仅注册的 SAML 或 OpenID Connect 提供者可允许任何人登录。"
                  : "人员还可使用 Google、Microsoft 或 Okta 登录。"}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Switch
                aria-label={"要求 SSO"}
                checked={settings.ssoRequired}
                disabled={saving}
                onCheckedChange={(checked) => onSetting("ssoRequired", checked)}
              />
            </ItemActions>
          </Item>
          <Separator />
          <Item size="sm">
            <ItemMedia variant="icon">
              <IconFingerprint />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{"SCIM 配置"}</ItemTitle>
              <ItemDescription className="line-clamp-none">
                {data.scim.configured
                  ? `目录基础 URL ${data.scim.baseUrl ?? "（设置 BETTER_AUTH_URL）"} 使用 SCIM_BEARER_TOKEN 持有者令牌。停用将结束会话、拒绝地址列表、退役连接器凭据并停止他们的电脑。`
                  : "关。设置 SCIM_BEARER_TOKEN 以接受来自 Okta、Entra 或其他目录的配置。"}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <span className="text-muted-foreground text-sm">
                {data.scim.configured ? "开" : "关闭"}
              </span>
            </ItemActions>
          </Item>
        </PageRows>
      </PageSection>

      <PageSection
        description={
          "开关是整个组织。角色可以被赋予不同的答案，目录组可以被授予组织关闭的能力。"
        }
        title={"能力"}
      >
        <PageRows>
          {data.capabilities.map((capability) => {
            const effective = capability.organization ?? capability.default;
            return (
              <div key={capability.capability}>
                <Item size="sm">
                  <ItemMedia variant="icon">
                    <IconToggleRight />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{capability.title}</ItemTitle>
                    <ItemDescription>
                      {effective
                        ? capability.description
                        : "除非角色或组授予，否则无人可以。"}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Switch
                      aria-label={capability.title}
                      checked={effective}
                      disabled={saving}
                      onCheckedChange={(checked) =>
                        onCapability(capability.capability, checked)
                      }
                    />
                  </ItemActions>
                </Item>
                <Separator />
              </div>
            );
          })}
          <Item
            render={
              <button onClick={() => setOverridesOpen(true)} type="button" />
            }
            size="sm"
          >
            <ItemMedia variant="icon">
              <IconUsersGroup />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{"角色和组覆盖"}</ItemTitle>
              <ItemDescription>
                {overrideCount === 0
                  ? "无：每个人都获得上面的开关"
                  : `${overrideCount} 设置`}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <IconChevronRight className="size-4 text-muted-foreground" />
            </ItemActions>
          </Item>
        </PageRows>
      </PageSection>

      <PageSection
        description={
          "机器人计算机可以连接的位置。应用于运行中的计算机，几秒内，无需重启。组策略替换组织的除非被锁定。"
        }
        title={"网络"}
      >
        <PageRows>
          <Item
            render={
              <button
                onClick={() =>
                  setNetworkScope({ scopeKind: "organization", scopeId: "" })
                }
                type="button"
              />
            }
            size="sm"
          >
            <ItemMedia variant="icon">
              <IconWorld />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{"组织"}</ItemTitle>
              <ItemDescription>
                {summarizePolicy(organizationPolicy)}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <IconChevronRight className="size-4 text-muted-foreground" />
            </ItemActions>
          </Item>
          {groupPolicies.map((policy) => (
            <div key={policy.scopeId}>
              <Separator />
              <Item
                render={
                  <button
                    onClick={() =>
                      setNetworkScope({
                        scopeKind: "group",
                        scopeId: policy.scopeId,
                      })
                    }
                    type="button"
                  />
                }
                size="sm"
              >
                <ItemMedia variant="icon">
                  <IconNetwork />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>
                    {"组："}
                    {policy.scopeId}
                  </ItemTitle>
                  <ItemDescription>{summarizePolicy(policy)}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <IconChevronRight className="size-4 text-muted-foreground" />
                </ItemActions>
              </Item>
            </div>
          ))}
        </PageRows>
        {data.groups.length > 0 ? (
          <Button
            className="mt-4"
            onClick={() => setNetworkScope({ scopeKind: "group", scopeId: "" })}
            size="sm"
            variant="outline"
          >
            {"添加群组策略"}
          </Button>
        ) : null}
      </PageSection>

      <PageSection
        description={
          "启用白名单后，机器人只能调用此处批准的MCP服务器上的工具。其他服务器的调用将被拒绝。"
        }
        title={"MCP服务器"}
      >
        <PageRows>
          <Item size="sm">
            <ItemMedia variant="icon">
              <IconPlug />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{"仅批准的服务器"}</ItemTitle>
              <ItemDescription>
                {settings.mcpAllowlist.enabled
                  ? `${settings.mcpAllowlist.servers.length} 已批准`
                  : "关：每个已注册服务器可按其授权使用。"}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Switch
                aria-label={"仅批准的 MCP 服务器"}
                checked={settings.mcpAllowlist.enabled}
                disabled={saving}
                onCheckedChange={(enabled) =>
                  onSetting("mcpAllowlist", {
                    ...settings.mcpAllowlist,
                    enabled,
                  })
                }
              />
            </ItemActions>
          </Item>
          {data.mcpServers.map((server) => {
            const approved = settings.mcpAllowlist.servers.includes(server.id);
            return (
              <div key={server.id}>
                <Separator />
                <Item size="sm">
                  <ItemMedia variant="icon">
                    <IconKey />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{server.title}</ItemTitle>
                    <ItemDescription>{server.url}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Switch
                      aria-label={`批准 ${server.title}`}
                      checked={approved}
                      disabled={saving}
                      onCheckedChange={(checked) =>
                        onSetting("mcpAllowlist", {
                          ...settings.mcpAllowlist,
                          servers: checked
                            ? [...settings.mcpAllowlist.servers, server.id]
                            : settings.mcpAllowlist.servers.filter(
                                (id) => id !== server.id,
                              ),
                        })
                      }
                    />
                  </ItemActions>
                </Item>
              </div>
            );
          })}
        </PageRows>
      </PageSection>

      <PageSection
        description={`内置机器人运行在 ${data.builtInModel ?? "此部署配置的模型"}。远程机器人自行选择；其流名称的模型被记录。`}
        title={"模型"}
      >
        <PageRows>
          <Item size="sm">
            <ItemMedia variant="icon">
              <IconShieldLock />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{"模型白名单"}</ItemTitle>
              <ItemDescription>
                {settings.modelAllowlist.enabled
                  ? "未列出的模型上的内置机器人将在运行前被拒绝。"
                  : "关闭：任何模型都可以服务运行。"}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Switch
                aria-label={"模型白名单"}
                checked={settings.modelAllowlist.enabled}
                disabled={saving}
                onCheckedChange={(enabled) =>
                  onSetting("modelAllowlist", {
                    ...settings.modelAllowlist,
                    enabled,
                  })
                }
              />
            </ItemActions>
          </Item>
          <Separator />
          <Item
            render={
              <button onClick={() => setModelsOpen(true)} type="button" />
            }
            size="sm"
          >
            <ItemMedia variant="icon">
              <IconKey />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{"允许的模型"}</ItemTitle>
              <ItemDescription>
                {settings.modelAllowlist.models.length === 0
                  ? "未列出"
                  : settings.modelAllowlist.models.join(", ")}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <IconChevronRight className="size-4 text-muted-foreground" />
            </ItemActions>
          </Item>
        </PageRows>
        <ModelUsage />
      </PageSection>

      <PageSection
        description={
          "当设置 OTEL_EXPORTER_OTLP_ENDPOINT 时，审计事件和机器人操作流式传输到你的 OpenTelemetry 收集器或 SIEM，并标记为 openbot.surface。"
        }
        title={"录音和导出"}
      >
        <PageRows>
          <Item size="sm">
            <ItemMedia variant="icon">
              <IconTerminal2 />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{"动作记录"}</ItemTitle>
              <ItemDescription>
                {settings.actionRecording
                  ? `机器人运行的 Shell 命令被记录，秘密已去除并保存 ${data.actionRecordRetentionDays} 天。`
                  : "关闭：命令仅在审计轨迹上。"}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Switch
                aria-label={"动作记录"}
                checked={settings.actionRecording}
                disabled={saving}
                onCheckedChange={(checked) =>
                  onSetting("actionRecording", checked)
                }
              />
            </ItemActions>
          </Item>
          <Separator />
          <Item size="sm">
            <ItemMedia variant="icon">
              <IconChartBar />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{"OpenTelemetry 导出"}</ItemTitle>
              <ItemDescription>
                {data.otel.configured
                  ? "通过 OTLP/HTTP 导出。"
                  : "未配置。在服务器上设置 OTEL_EXPORTER_OTLP_ENDPOINT。"}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <span className="text-muted-foreground text-sm">
                {data.otel.configured ? "开" : "关闭"}
              </span>
            </ItemActions>
          </Item>
        </PageRows>
        {settings.actionRecording ? <RecordedActions /> : null}
      </PageSection>

      <PageSection
        description={
          "停止计算机会结束其运行的机器人并保留其磁盘。机器人下次会话获得新计算机。停止一个人的从People。"
        }
        title={"计算机"}
      >
        <PageRows>
          <Item
            render={<button onClick={() => setDaysOpen(true)} type="button" />}
            size="sm"
          >
            <ItemMedia variant="icon">
              <IconDeviceDesktop />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{"停止非活跃计算机"}</ItemTitle>
              <ItemDescription>
                {settings.inactiveComputerDays === 0
                  ? "关闭"
                  : `在 ${settings.inactiveComputerDays} 天未使用后`}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <IconChevronRight className="size-4 text-muted-foreground" />
            </ItemActions>
          </Item>
        </PageRows>
        <SweepNow />
      </PageSection>

      <OverridesDialog
        data={data}
        onOpenChange={setOverridesOpen}
        open={overridesOpen}
      />
      {networkScope ? (
        <NetworkDialog
          data={data}
          initial={networkScope}
          onClose={() => setNetworkScope(undefined)}
        />
      ) : null}
      <ListDialog
        description={
          "每行一个模型，格式为 provider/model，例如 openai/gpt-5.6-terra。"
        }
        initial={settings.modelAllowlist.models}
        onClose={() => setModelsOpen(false)}
        onSave={(models) =>
          onSetting("modelAllowlist", { ...settings.modelAllowlist, models })
        }
        open={modelsOpen}
        title={"允许的模型"}
      />
      <DaysDialog
        initial={settings.inactiveComputerDays}
        onClose={() => setDaysOpen(false)}
        onSave={(days) => onSetting("inactiveComputerDays", days)}
        open={daysOpen}
      />
    </>
  );
}

function ModelUsage() {
  const usage = useQuery(modelUsageQueryOptions(30));
  if (usage.isPending) return null;
  if (usage.error)
    return (
      <p className="mt-4 text-destructive text-sm" role="alert">
        {"无法加载模型使用情况。"}
      </p>
    );
  if (usage.data.summary.length === 0)
    return <PageEmpty>{"最近30天内未记录机器人运行。"}</PageEmpty>;
  return (
    <PageRows>
      {usage.data.summary.map((row, index) => (
        <div key={`${row.model}-${row.source}`}>
          {index > 0 ? <Separator /> : null}
          <Item size="sm">
            <ItemMedia variant="icon">
              <IconChartBar />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{row.model}</ItemTitle>
              <ItemDescription>
                {row.runs} {"由...运行"}
                {row.people} {row.people === 1 ? "人员" : "人员"} {"30天内"}
                {row.refused > 0 ? `· ${row.refused} 已从允许列表移除` : ""} ·{" "}
                {row.source}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <span className="text-muted-foreground text-sm">
                {new Date(row.lastUsedAt).toLocaleDateString("zh-CN")}
              </span>
            </ItemActions>
          </Item>
        </div>
      ))}
    </PageRows>
  );
}

function RecordedActions() {
  const actions = useQuery(actionRecordsQueryOptions());
  if (actions.isPending) return null;
  if (actions.error)
    return (
      <p className="mt-4 text-destructive text-sm" role="alert">
        {"无法加载录制的操作。"}
      </p>
    );
  if (actions.data.length === 0)
    return <PageEmpty>{"尚未记录命令。"}</PageEmpty>;
  return (
    <PageRows>
      {actions.data.map((action, index) => (
        <div key={action.id}>
          {index > 0 ? <Separator /> : null}
          <Item size="sm">
            <ItemContent>
              <ItemTitle className="font-mono text-xs">
                {action.command}
              </ItemTitle>
              <ItemDescription>
                {action.surface === "local"
                  ? "成员的机器"
                  : `机器人 ${action.botId ?? "?"}`}{" "}
                · {action.outcome} ·{" "}
                {new Date(action.createdAt).toLocaleString("zh-CN")}
              </ItemDescription>
            </ItemContent>
          </Item>
        </div>
      ))}
    </PageRows>
  );
}

function SweepNow() {
  const sweep = useMutation(terminateInactiveComputersMutationOptions());
  return (
    <div className="mt-4 flex items-center gap-3">
      <Button
        disabled={sweep.isPending}
        onClick={() => sweep.mutate()}
        size="sm"
        variant="outline"
      >
        {sweep.isPending ? "正在停止…" : "立即停止非活跃计算机"}
      </Button>
      {sweep.data ? (
        <span className="text-muted-foreground text-sm">
          {"已停止"}
          {sweep.data.stopped.length}.
        </span>
      ) : null}
      {sweep.error ? (
        <span className="text-destructive text-sm" role="alert">
          {sweep.error.message}
        </span>
      ) : null}
    </div>
  );
}

type Tri = "inherit" | "on" | "off";

function OverridesDialog({
  data,
  open,
  onOpenChange,
}: {
  data: EnterpriseOverview;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setCapability = useMutation(setCapabilityMutationOptions(queryClient));
  const scopes: { kind: "role" | "group"; id: string; label: string }[] = [
    { kind: "role", id: "admin", label: "管理员" },
    { kind: "role", id: "user", label: "成员" },
    ...data.groups.map((group) => ({
      kind: "group" as const,
      id: group,
      label: `组：${group}`,
    })),
  ];
  const [scopeIndex, setScopeIndex] = useState(0);
  const scope = scopes[scopeIndex] ?? scopes[0];

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{"角色和组覆盖"}</DialogTitle>
        </DialogHeader>
        <DialogBody className="mt-4 space-y-4 overflow-y-auto">
          <Select
            onValueChange={(value) => setScopeIndex(Number(value))}
            value={String(scopeIndex)}
          >
            <SelectTrigger aria-label={"范围"}>
              <SelectValue>{scope?.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {scopes.map((candidate, index) => (
                  <SelectItem
                    key={`${candidate.kind}:${candidate.id}`}
                    value={String(index)}
                  >
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            {scope?.kind === "group"
              ? "群组只能扩大：Grant 赋予成员能力，即使组织已关闭。"
              : "角色的回答替换持有该角色的每个人组织的切换。"}
          </p>
          {scope
            ? data.capabilities.map((capability) => {
                const stored =
                  scope.kind === "role"
                    ? capability.roles[scope.id as "admin" | "user"]
                    : capability.groups[scope.id];
                const value: Tri =
                  stored === undefined ? "inherit" : stored ? "on" : "off";
                return (
                  <div
                    className="flex items-center justify-between gap-4"
                    key={capability.capability}
                  >
                    <Label>{capability.title}</Label>
                    <Select
                      onValueChange={(next) =>
                        setCapability.mutate({
                          scopeKind: scope.kind,
                          scopeId: scope.id,
                          capability: capability.capability,
                          allowed: next === "inherit" ? null : next === "on",
                        })
                      }
                      value={value}
                    >
                      <SelectTrigger
                        aria-label={`${capability.title} 用于 ${scope.label}`}
                        className="w-36"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="inherit">{"继承"}</SelectItem>
                          <SelectItem value="on">
                            {scope.kind === "group" ? "授权" : "开"}
                          </SelectItem>
                          {scope.kind === "role" ? (
                            <SelectItem value="off">{"关闭"}</SelectItem>
                          ) : null}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                );
              })
            : null}
          {setCapability.error ? (
            <p className="text-destructive text-sm" role="alert">
              {setCapability.error.message}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter className="mt-4">
          <Button onClick={() => onOpenChange(false)} size="sm" type="button">
            {"完成"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NetworkDialog({
  data,
  initial,
  onClose,
}: {
  data: EnterpriseOverview;
  initial: { scopeKind: "organization" | "group"; scopeId: string };
  onClose: () => void;
}) {
  const existing = data.network.find(
    (row) =>
      row.scopeKind === initial.scopeKind && row.scopeId === initial.scopeId,
  );
  const [group, setGroup] = useState(initial.scopeId || data.groups[0] || "");
  const [mode, setMode] = useState<NetworkMode>(
    existing?.mode ?? "defaults_plus_allowlist",
  );
  const [rules, setRules] = useState(rulesToText(existing?.rules ?? []));
  const [locked, setLocked] = useState(existing?.locked ?? false);
  const save = useMutation(setNetworkPolicyMutationOptions(queryClient));
  const remove = useMutation(removeNetworkPolicyMutationOptions(queryClient));
  const scopeId = initial.scopeKind === "group" ? group : "";

  return (
    <Dialog onOpenChange={(open) => (open ? undefined : onClose())} open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {initial.scopeKind === "organization"
              ? "组织网络策略"
              : "组网络策略"}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(
              {
                scopeKind: initial.scopeKind,
                scopeId,
                mode,
                rules: rulesFromText(rules),
                locked,
              },
              { onSuccess: onClose },
            );
          }}
        >
          <DialogBody className="mt-4 space-y-4 overflow-y-auto">
            {initial.scopeKind === "group" && !initial.scopeId ? (
              <div className="space-y-1.5">
                <Label>{"组"}</Label>
                <Select
                  onValueChange={(value) => setGroup(String(value))}
                  value={group}
                >
                  <SelectTrigger aria-label={"组"}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {data.groups.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label>{"模式"}</Label>
              <Select
                onValueChange={(value) => setMode(value as NetworkMode)}
                value={mode}
              >
                <SelectTrigger aria-label={"模式"}>
                  <SelectValue>{MODE_NAMES[mode]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {(Object.keys(MODE_NAMES) as NetworkMode[]).map(
                      (candidate) => (
                        <SelectItem key={candidate} value={candidate}>
                          {MODE_NAMES[candidate]}
                        </SelectItem>
                      ),
                    )}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="network-rules">{"允许列表"}</Label>
              <Textarea
                className="font-mono text-xs"
                id="network-rules"
                onChange={(event) => setRules(event.target.value)}
                placeholder={"example.com *.corp.example 10.0.0.0/8 443,5432"}
                rows={8}
                value={rules}
              />
              <p className="text-muted-foreground text-xs">
                {
                  "每行一个。域名覆盖其子域名；*.name 仅覆盖子域名。IP 范围可指定端口。默认值为"
                }{" "}
                {data.defaultDestinations.slice(0, 4).join(", ")} {"和"}{" "}
                {data.defaultDestinations.length - 4} {"更多包和源主机。"}
              </p>
            </div>
            {initial.scopeKind === "organization" ? (
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="network-locked">
                  {"锁定：组不得替换此策略"}
                </Label>
                <Switch
                  checked={locked}
                  id="network-locked"
                  onCheckedChange={setLocked}
                />
              </div>
            ) : null}
            {(save.error ?? remove.error) ? (
              <p className="text-destructive text-sm" role="alert">
                {(save.error ?? remove.error)?.message}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter className="mt-4">
            {existing ? (
              <Button
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(
                    { scopeKind: initial.scopeKind, scopeId },
                    { onSuccess: onClose },
                  )
                }
                size="sm"
                type="button"
                variant="destructive"
              >
                {"移除策略"}
              </Button>
            ) : null}
            <Button onClick={onClose} size="sm" type="button" variant="outline">
              {"取消"}
            </Button>
            <Button loading={save.isPending}
              disabled={
                save.isPending || (initial.scopeKind === "group" && !scopeId)
              }
              size="sm"
              type="submit"
            >
              {save.isPending ? "正在保存…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ListDialog({
  open,
  title,
  description,
  initial,
  onSave,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  initial: string[];
  onSave: (values: string[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial.join("\n"));
  return (
    <Dialog
      onOpenChange={(next) => (next ? setText(initial.join("\n")) : onClose())}
      open={open}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="mt-4 space-y-2 overflow-y-auto">
          <Textarea
            className="font-mono text-xs"
            onChange={(event) => setText(event.target.value)}
            rows={8}
            value={text}
          />
          <p className="text-muted-foreground text-xs">{description}</p>
        </DialogBody>
        <DialogFooter className="mt-4">
          <Button onClick={onClose} size="sm" type="button" variant="outline">
            {"取消"}
          </Button>
          <Button
            onClick={() => {
              onSave(
                text
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean),
              );
              onClose();
            }}
            size="sm"
            type="button"
          >
            {"保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DaysDialog({
  open,
  initial,
  onSave,
  onClose,
}: {
  open: boolean;
  initial: number;
  onSave: (days: number) => void;
  onClose: () => void;
}) {
  const [days, setDays] = useState(String(initial));
  const parsed = Number(days);
  const valid = Number.isInteger(parsed) && parsed >= 0 && parsed <= 3650;
  return (
    <Dialog
      onOpenChange={(next) => (next ? setDays(String(initial)) : onClose())}
      open={open}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{"停止非活跃计算机"}</DialogTitle>
        </DialogHeader>
        <DialogBody className="mt-4 space-y-2">
          <Label htmlFor="inactive-days">{"未使用天数"}</Label>
          <Input
            id="inactive-days"
            inputMode="numeric"
            onChange={(event) => setDays(event.target.value)}
            value={days}
          />
          <p className="text-muted-foreground text-xs">
            {"0 关闭它。每小时检查一次。"}
          </p>
        </DialogBody>
        <DialogFooter className="mt-4">
          <Button onClick={onClose} size="sm" type="button" variant="outline">
            {"取消"}
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              onSave(parsed);
              onClose();
            }}
            size="sm"
            type="button"
          >
            {"保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
