import { IconDeviceDesktop, IconPlayerStopFilled, IconPlugConnected, IconShieldCheck } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ApprovalsCard, DeviceRow } from "@/components/devices/devices";
import { PageSection, PageShell, PageSkeleton } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, ErrorCard, StatTile } from "@/components/ui/skyglass";
import { deviceListQueryOptions } from "@/lib/devices";

export const Route = createFileRoute("/_authed/admin/devices")({
  component: AdminDevicesPage,
});

/** 管理后台 → 设备（模板 E）：部署里所有 PC 节点。 */
function AdminDevicesPage() {
  const list = useQuery(deviceListQueryOptions(true));
  const devices = list.data?.devices ?? [];
  const active = devices.filter((device) => !device.revoked);
  return (
    <PageShell
      action={
        <Button nativeButton={false} render={<Link to="/settings/devices" />} size="sm" variant="outline">
          {"添加电脑"}
        </Button>
      }
      description="这个部署里所有装了 ChisaBot PC 客户端的电脑：在线状态、紧急停止和待审批。点进去可以改能力、文件夹、机器人权限并查看操作记录。"
      title="电脑操作（PC）"
    >
      {list.isPending ? (
        <PageSkeleton rows={4} tall />
      ) : list.isError ? (
        <ErrorCard description={list.error.message} title="设备列表暂时无法读取" />
      ) : (
        <>
          <div className="magpie-stats">
            <StatTile icon={<IconDeviceDesktop className="size-4" />} label="设备" value={active.length} delta={devices.length > active.length ? `另有 ${devices.length - active.length} 台已撤销` : undefined} />
            <StatTile icon={<IconPlugConnected className="size-4" />} label="在线" tone={active.some((d) => d.online) ? "ok" : undefined} value={active.filter((d) => d.online).length} />
            <StatTile icon={<IconShieldCheck className="size-4" />} label="待审批" tone={list.data.approvals.length ? "warn" : undefined} value={list.data.approvals.length} />
            <StatTile icon={<IconPlayerStopFilled className="size-4" />} label="紧急停止中" tone={active.some((d) => d.paused) ? "danger" : undefined} value={active.filter((d) => d.paused).length} />
          </div>
          <ApprovalsCard approvals={list.data.approvals} />
          <PageSection title="全部设备">
            {devices.length ? (
              <Card>
                {devices.map((device) => (
                  <DeviceRow device={device} key={device.id} showOwner />
                ))}
              </Card>
            ) : (
              <EmptyState description="还没有任何电脑登记。在 设置 → 电脑操作 下载 PC 客户端。" icon={<IconDeviceDesktop className="size-6" />} title="还没有设备" />
            )}
          </PageSection>
        </>
      )}
    </PageShell>
  );
}
