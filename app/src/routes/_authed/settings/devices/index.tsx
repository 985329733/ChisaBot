import { IconDownload } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AddDeviceCard, ApprovalsCard, DeviceRow, NoDevices } from "@/components/devices/devices";
import { PageSection, PageShell, PageSkeleton } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Card, ErrorCard } from "@/components/ui/skyglass";
import { deviceListQueryOptions, pcDownloadQueryOptions } from "@/lib/devices";
import { usePcLocal } from "@/lib/pc-bridge";

export const Route = createFileRoute("/_authed/settings/devices/")({
  component: DevicesPage,
});

/** 偏好设置 → 设备（模板 B）：待审批 → 设备列表 → 添加一台电脑 / 下载 PC 客户端。docs/pc-node.md */
function DevicesPage() {
  const list = useQuery(deviceListQueryOptions());
  const [local] = usePcLocal();
  const download = useQuery(pcDownloadQueryOptions());
  const installer = download.data?.files.find((file) => file.kind === "installer");
  const devices = list.data?.devices ?? [];
  const active = devices.filter((device) => !device.revoked);
  const revoked = devices.filter((device) => device.revoked);
  return (
    <PageShell
      action={
        installer && !local ? (
          <Button nativeButton={false} render={<a download href={installer.url} />} size="sm">
            <IconDownload />
            {"下载 PC 客户端"}
          </Button>
        ) : undefined
      }
      description="装了 ChisaBot PC 客户端的电脑。你可以在任何一端（网页、手机、PC）管理它们；机器人只能在你开启的能力和允许的文件夹里操作，每一步都有记录。"
      title="电脑操作"
    >
      {list.isPending ? (
        <PageSkeleton rows={3} />
      ) : list.isError ? (
        <ErrorCard
          action={
            <Button className="mt-2" onClick={() => void list.refetch()} size="sm" variant="outline">
              {"重试"}
            </Button>
          }
          description={list.error.message}
          title="设备列表暂时无法读取"
        />
      ) : (
        <>
          <ApprovalsCard approvals={list.data.approvals} />
          <PageSection title={`我的电脑${active.length ? `（${active.length}）` : ""}`}>
            {active.length ? (
              <Card>
                {active.map((device) => (
                  <DeviceRow device={device} isThisPc={local?.deviceId === device.id} key={device.id} />
                ))}
              </Card>
            ) : (
              <NoDevices />
            )}
          </PageSection>
          {revoked.length ? (
            <PageSection description="令牌已作废，不能再连接。可以在详情里删除记录。" title="已撤销">
              <Card>
                {revoked.map((device) => (
                  <DeviceRow device={device} key={device.id} />
                ))}
              </Card>
            </PageSection>
          ) : null}
        </>
      )}
      <PageSection title="添加一台电脑">
        <AddDeviceCard />
      </PageSection>
    </PageShell>
  );
}
