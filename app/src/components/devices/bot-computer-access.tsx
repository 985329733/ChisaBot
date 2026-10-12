import { IconBrandWindows, IconChevronRight, IconDeviceDesktop, IconDownload } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { CAPABILITY_INFO, DEVICE_CAPABILITIES, type DeviceView } from "../../../../shared/devices";
import { useAsyncAction } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { deviceKeys, deviceListQueryOptions, patchDevice, platformLabel, seenText } from "@/lib/devices";
import { cn } from "@/lib/utils";

/**
 * 机器人这一侧的「电脑操作」（docs/pc-node.md §7）：这个机器人能操作哪几台 PC。
 *
 * 机器人只有在 ① 设备勾选了它、② 设备至少开了一项能力 时才拿得到电脑工具（server devices/tools.ts）。
 * 两件事原来都只在 偏好设置 → 电脑操作 → 某台电脑 里，机器人这边看不到，于是「电脑操作」像是消失了。
 * 这里直接给出开关（勾选 / 取消这个机器人），能力仍在设备页里改（高风险，需要逐项看说明）。
 */
export function BotComputerAccess({ agentId, botName, compact }: { agentId: string; botName: string; compact?: boolean }) {
  const list = useQuery(deviceListQueryOptions());
  const devices = (list.data?.devices ?? []).filter((device) => !device.revoked);
  if (list.isPending) return <p className="bca-line">{"正在读取你的电脑…"}</p>;
  if (list.isError) return <p className="bca-line is-error">{`电脑列表暂时无法读取：${list.error.message}`}</p>;
  if (devices.length === 0)
    return (
      <div className="bca-empty">
        <IconDeviceDesktop className="size-5 shrink-0 opacity-70" />
        <div className="min-w-0 flex-1">
          <div className="bca-t">{"还没有连接电脑"}</div>
          <div className="bca-s">{"在电脑上安装 ChisaBot PC 客户端并登录，机器人才能在你允许的范围内操作它。"}</div>
        </div>
        <Button nativeButton={false} render={<Link to="/settings/devices" />} size="sm" variant="outline">
          <IconDownload />
          {"添加电脑"}
        </Button>
      </div>
    );
  return (
    <div className={cn("bca-list", compact && "is-compact")}>
      {devices.map((device) => (
        <BotDeviceRow agentId={agentId} botName={botName} device={device} key={device.id} />
      ))}
    </div>
  );
}

function BotDeviceRow({ device, agentId, botName }: { device: DeviceView; agentId: string; botName: string }) {
  const queryClient = useQueryClient();
  const allowed = device.botIds.includes(agentId);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const checked = optimistic ?? allowed;
  const enabled = DEVICE_CAPABILITIES.filter((cap) => device.capabilities[cap] !== "off");
  const save = useAsyncAction(
    async (next: boolean) => {
      const botIds = next ? [...new Set([...device.botIds, agentId])] : device.botIds.filter((id) => id !== agentId);
      const updated = await patchDevice(device.id, { botIds });
      queryClient.setQueryData(deviceKeys.detail(device.id), updated);
      await queryClient.invalidateQueries({ queryKey: deviceKeys.all });
    },
    { errorToast: (error) => `保存失败：${error.message}` },
  );
  const Icon = device.platform === "win32" ? IconBrandWindows : IconDeviceDesktop;
  const status = device.paused ? "已紧急停止" : device.online ? "在线" : seenText(device.lastSeenAt, device.online);
  const feedback =
    save.state === "pending" ? "保存中…" : save.state === "success" ? "已保存" : save.state === "error" ? "保存失败" : null;
  return (
    <div className="bca-row">
      <span className={cn("bca-ico", device.online && !device.paused && "is-online", device.paused && "is-paused")}>
        <Icon className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="bca-t">
          {device.name}
          <span className="bca-meta">{`${platformLabel(device.platform)} · ${status}`}</span>
        </div>
        <div className={cn("bca-s", checked && enabled.length === 0 && "is-warn")}>
          {enabled.length
            ? `已开启：${enabled.map((cap) => CAPABILITY_INFO[cap].label).join("、")}`
            : checked
              ? "能力都还关着，机器人暂时什么也做不了。点右边箭头去开启。"
              : "能力都还关着。"}
        </div>
      </div>
      <span aria-live="polite" className={cn("bca-fb", save.state !== "idle" && `is-${save.state}`)}>
        {feedback}
      </span>
      <Switch
        aria-label={`允许「${botName}」操作「${device.name}」`}
        checked={checked}
        disabled={save.state === "pending"}
        onCheckedChange={(next) => {
          setOptimistic(next);
          void save.run(next).then(() => setOptimistic(null));
        }}
        title={checked ? `「${botName}」可以操作这台电脑` : `允许「${botName}」操作这台电脑`}
      />
      <Link
        aria-label={`「${device.name}」的能力与权限`}
        className="bca-go"
        params={{ deviceId: device.id }}
        title={"能力、允许的文件夹、操作记录"}
        to="/settings/devices/$deviceId"
      >
        <IconChevronRight className="size-4" />
      </Link>
    </div>
  );
}

/** 机器人「⋯ → 电脑操作…」打开的玻璃弹窗。 */
export function BotComputerAccessDialog({
  agentId,
  botName,
  open,
  onOpenChange,
}: {
  agentId: string;
  botName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--accent-blue)]/12 text-[var(--accent-blue)]">
              <IconDeviceDesktop className="size-4" />
            </span>
            <span className="min-w-0 break-words">{`电脑操作 ·「${botName}」`}</span>
          </DialogTitle>
          <DialogDescription>
            {"打开开关，这个机器人就能在你装了 PC 客户端的电脑上工作：只限你开启的能力和允许的文件夹，高风险操作会先问你，每一步都有记录，随时可以紧急停止。"}
          </DialogDescription>
        </DialogHeader>
        {open ? <BotComputerAccess agentId={agentId} botName={botName} /> : null}
        <DialogFooter className="mt-2">
          <Button nativeButton={false} render={<Link to="/settings/devices" />} variant="outline">
            {"全部电脑与审批"}
          </Button>
          <Button onClick={() => onOpenChange(false)}>{"完成"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
