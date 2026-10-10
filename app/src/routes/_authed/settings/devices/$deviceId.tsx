import { IconHistory, IconPlayerPlayFilled, IconPlayerStopFilled, IconPlugConnected, IconSettings, IconShieldLock } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ApprovalsCard, AuditList, DeviceIcon, DevicePermissions, StatusBadge } from "@/components/devices/devices";
import { PageShell, PageSkeleton } from "@/components/layout/page-shell";
import { useAsyncAction } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm";
import { Card, ErrorCard, SettingRow } from "@/components/ui/skyglass";
import { toast } from "@/components/ui/toast";
import {
  deleteDevice,
  deviceAuditQueryOptions,
  deviceKeys,
  deviceListQueryOptions,
  deviceQueryOptions,
  patchDevice,
  platformLabel,
  revokeDevice,
  seenText,
  testDevice,
} from "@/lib/devices";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/settings/devices/$deviceId")({
  component: DevicePage,
});

type Tab = "permissions" | "audit" | "settings";
const TABS: Array<{ id: Tab; label: string; Icon: typeof IconShieldLock }> = [
  { id: "permissions", label: "权限", Icon: IconShieldLock },
  { id: "audit", label: "操作记录", Icon: IconHistory },
  { id: "settings", label: "设备", Icon: IconSettings },
];

/** 设备详情（模板 C）：大图标页头 + 测试连接 / 紧急停止 → 标签（权限 / 操作记录 / 设备）。 */
function DevicePage() {
  const { deviceId } = Route.useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const device = useQuery(deviceQueryOptions(deviceId));
  const list = useQuery(deviceListQueryOptions());
  const audit = useQuery(deviceAuditQueryOptions(deviceId));
  const [tab, setTab] = useState<Tab>("permissions");

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: deviceKeys.all });
  };
  const test = useAsyncAction(
    async () => {
      const result = await testDevice(deviceId);
      toast.success(`连接正常：${String(result.hostname ?? "")} · ${String(result.release ?? "")}`);
      await refresh();
    },
    { errorToast: (error) => `测试失败：${error.message}` },
  );
  const toggleStop = useAsyncAction(async (paused: boolean) => {
    const next = await patchDevice(deviceId, { paused });
    queryClient.setQueryData(deviceKeys.detail(deviceId), next);
    await refresh();
  });
  const revoke = useAsyncAction(async () => {
    await revokeDevice(deviceId);
    await refresh();
  });
  const remove = useAsyncAction(async () => {
    await deleteDevice(deviceId);
    await queryClient.invalidateQueries({ queryKey: deviceKeys.all });
    void navigate({ to: "/settings/devices" });
  });

  const back = { linkProps: { to: "/settings/devices" as const }, label: "设备" };
  if (device.isPending) {
    return (
      <PageShell backButton={back} title="设备">
        <PageSkeleton rows={4} tall />
      </PageShell>
    );
  }
  if (device.isError || !device.data) {
    return (
      <PageShell backButton={back} title="设备">
        <ErrorCard description={device.error?.message ?? "没有这台设备。"} title="无法读取这台设备" />
      </PageShell>
    );
  }
  const d = device.data;
  const approvals = (list.data?.approvals ?? []).filter((approval) => approval.deviceId === d.id);
  return (
    <PageShell backButton={back} title={d.name}>
      <div className="device-hero">
        <DeviceIcon device={d} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="device-hero-badges">
            <StatusBadge device={d} />
            <span className="device-badge">{platformLabel(d.platform)}</span>
            {d.clientVersion ? <span className="device-badge">{`客户端 ${d.clientVersion}`}</span> : null}
          </div>
          <p className="device-hero-s">
            {[d.osVersion, d.hostname, seenText(d.lastSeenAt, d.online), d.lastIp ? `IP ${d.lastIp}` : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        {!d.revoked ? (
          <div className="device-hero-actions">
            <Button disabled={!d.online || d.paused} feedback="test" onClick={() => void test.run()} size="sm" state={test.state} variant="outline">
              <IconPlugConnected />
              {"测试连接"}
            </Button>
            {d.paused ? (
              <Button
                feedback={{ pending: "解除中…", success: "已解除", error: "解除失败" }}
                onClick={() => void toggleStop.run(false)}
                size="sm"
                state={toggleStop.state}
                variant="outline"
              >
                <IconPlayerPlayFilled />
                {"解除紧急停止"}
              </Button>
            ) : (
              <Button
                feedback={{ pending: "停止中…", success: "已停止", error: "停止失败" }}
                onClick={() => void toggleStop.run(true)}
                size="sm"
                state={toggleStop.state}
                variant="destructive"
              >
                <IconPlayerStopFilled />
                {"紧急停止"}
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {d.paused && !d.revoked ? (
        <div className="device-stopbar" role="status">
          <IconPlayerStopFilled className="size-4" />
          {"紧急停止中：这台电脑拒绝一切远程操作，进行中的操作已取消。可以在这里或 PC 托盘菜单解除。"}
        </div>
      ) : null}

      <ApprovalsCard approvals={approvals} />

      <div aria-label="设备分区" className="device-tabs" role="tablist">
        {TABS.map(({ id, label, Icon }) => (
          <button aria-selected={tab === id} className={cn("device-tab", tab === id && "is-active")} key={id} onClick={() => setTab(id)} role="tab" type="button">
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "permissions" ? <DevicePermissions device={d} /> : null}
      {tab === "audit" ? (
        <Card className="device-audit-card">
          {audit.isPending ? <PageSkeleton rows={4} /> : <AuditList entries={audit.data ?? []} />}
        </Card>
      ) : null}
      {tab === "settings" ? (
        <>
          <Card>
            <SettingRow description="登记时生成，用来区分同名电脑。" title="设备 ID">
              <code className="device-code">{d.id}</code>
            </SettingRow>
            <SettingRow description={new Date(d.createdAt).toLocaleString("zh-CN")} title="登记时间" />
          </Card>
          <section className="device-section">
            <h2 className="device-section-t is-danger">{"危险区"}</h2>
            <Card className="device-danger">
              {!d.revoked ? (
                <SettingRow description="立即作废这台电脑的令牌并断开连接。之后它需要重新登录才能再次连接。" title="撤销设备">
                  <Button
                    feedback="revoke"
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: `撤销「${d.name}」？`,
                        description: "这台电脑会立即断开，机器人不能再操作它。PC 客户端需要重新登录才能再次连接。",
                        confirmLabel: "撤销",
                        destructive: true,
                      });
                      if (ok) void revoke.run();
                    }}
                    size="sm"
                    state={revoke.state}
                    variant="destructive"
                  >
                    {"撤销"}
                  </Button>
                </SettingRow>
              ) : null}
              <SettingRow description="删除这台设备和它的全部操作记录（不可恢复）。" title="删除设备">
                <Button
                  feedback="delete"
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: `删除「${d.name}」？`,
                      description: "会同时删除这台设备的权限设置和全部操作记录，无法恢复。",
                      confirmLabel: "删除",
                      destructive: true,
                    });
                    if (ok) void remove.run();
                  }}
                  size="sm"
                  state={remove.state}
                  variant="destructive"
                >
                  {"删除"}
                </Button>
              </SettingRow>
            </Card>
          </section>
        </>
      ) : null}
    </PageShell>
  );
}
