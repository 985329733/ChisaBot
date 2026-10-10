import {
  IconBrandWindows,
  IconCheck,
  IconChevronRight,
  IconClipboard,
  IconDeviceDesktop,
  IconDownload,
  IconExternalLink,
  IconFileText,
  IconFolder,
  IconFolderPlus,
  IconKeyboard,
  IconPencil,
  IconPhoto,
  IconPlayerStopFilled,
  IconShieldCheck,
  IconTerminal2,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  CAPABILITY_INFO,
  type CapabilityPolicy,
  DEVICE_CAPABILITIES,
  type DeviceApprovalView,
  type DeviceAuditEntry,
  type DeviceCapabilities,
  type DeviceCapability,
  type DeviceView,
  OPERATION_LABEL,
} from "../../../../shared/devices";
import { useAsyncAction } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { Card, CardHeader, EmptyState, ListRow, SaveBar, SettingRow } from "@/components/ui/skyglass";
import { agentListQueryOptions } from "@/lib/agents/queries";
import {
  ACTION_LABEL,
  bytesText,
  decideApproval,
  deviceKeys,
  OUTCOME_LABEL,
  type PcDownload,
  patchDevice,
  pcDownloadQueryOptions,
  platformLabel,
  seenText,
} from "@/lib/devices";
import { type PcLocalPatch, type PcLocalState, pcBridge } from "@/lib/pc-bridge";
import { cn } from "@/lib/utils";

const CAP_ICON: Record<DeviceCapability, typeof IconTerminal2> = {
  shell: IconTerminal2,
  files_read: IconFileText,
  files_write: IconPencil,
  screenshot: IconPhoto,
  input: IconKeyboard,
  open: IconExternalLink,
  clipboard: IconClipboard,
};

export function DeviceIcon({ device, size = "md" }: { device: Pick<DeviceView, "platform" | "online" | "paused" | "revoked">; size?: "md" | "lg" }) {
  const Icon = device.platform === "win32" ? IconBrandWindows : IconDeviceDesktop;
  const status = device.revoked ? "is-revoked" : device.paused ? "is-paused" : device.online ? "is-online" : "is-offline";
  return (
    <span className={cn("device-icon", size === "lg" && "is-lg", status)}>
      <Icon className={size === "lg" ? "size-8" : "size-5"} />
      <span aria-hidden className="device-icon-dot" />
    </span>
  );
}

export function StatusBadge({ device }: { device: Pick<DeviceView, "online" | "paused" | "revoked"> }) {
  if (device.revoked) return <span className="device-badge is-muted">{"已撤销"}</span>;
  if (device.paused)
    return (
      <span className="device-badge is-danger">
        <IconPlayerStopFilled className="size-3" />
        {"已紧急停止"}
      </span>
    );
  return device.online ? (
    <span className="device-badge is-ok">
      <span aria-hidden className="device-dot is-ok" />
      {"在线"}
    </span>
  ) : (
    <span className="device-badge">
      <span aria-hidden className="device-dot" />
      {"离线"}
    </span>
  );
}

export function ThisPcBadge() {
  return (
    <span className="device-badge is-accent">
      <IconDeviceDesktop className="size-3" />
      {"这台电脑"}
    </span>
  );
}

function enabledCount(capabilities: DeviceCapabilities) {
  return DEVICE_CAPABILITIES.filter((cap) => capabilities[cap] !== "off").length;
}

export function DeviceRow({ device, showOwner, isThisPc }: { device: DeviceView; showOwner?: boolean; isThisPc?: boolean }) {
  const caps = enabledCount(device.capabilities);
  return (
    <Link className="device-row-link" params={{ deviceId: device.id }} to="/settings/devices/$deviceId">
      <ListRow
        actions={
          <span className="device-row-actions">
            {isThisPc ? <ThisPcBadge /> : null}
            <StatusBadge device={device} />
            <IconChevronRight aria-hidden className="size-4 text-[var(--ink-3)]" />
          </span>
        }
        icon={<DeviceIcon device={device} />}
        sub={[
          platformLabel(device.platform),
          device.hostname,
          seenText(device.lastSeenAt, device.online),
          caps ? `已开启 ${caps} 项能力` : "未开启能力",
          showOwner ? `所有者 ${device.ownerUserId.slice(0, 8)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        title={device.name}
      />
    </Link>
  );
}

/**
 * 审批剩余时间。expiresAt / createdAt 都是服务器时钟，而这台电脑 / 手机的时钟可能和服务器差几十秒甚至几分钟，
 * 直接拿 expiresAt − Date.now() 会出现一打开就「0 秒」。所以：本机算出的剩余时间落在 (0, 总时长] 内才信它，
 * 否则按「刚收到」处理（剩余 = 总时长），之后用本机的单调时钟倒数。
 */
function useApprovalCountdown(approval: Pick<DeviceApprovalView, "createdAt" | "expiresAt">) {
  const [deadline] = useState(() => {
    const ttl = Math.max(0, Date.parse(approval.expiresAt) - Date.parse(approval.createdAt)) || 120_000;
    const naive = Date.parse(approval.expiresAt) - Date.now();
    return performance.now() + (naive > 0 && naive <= ttl ? naive : ttl);
  });
  const [left, setLeft] = useState(() => Math.max(0, deadline - performance.now()));
  useEffect(() => {
    const timer = setInterval(() => setLeft(Math.max(0, deadline - performance.now())), 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  return left;
}

function ApprovalRow({ approval }: { approval: DeviceApprovalView }) {
  const queryClient = useQueryClient();
  const decide = useAsyncAction(async (decision: "approve" | "deny") => {
    await decideApproval(approval.id, decision);
    await queryClient.invalidateQueries({ queryKey: deviceKeys.all });
  });
  const left = useApprovalCountdown(approval);
  return (
    <div className="device-approval list-enter">
      <span className="device-approval-ic">
        <IconShieldCheck className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="device-approval-t">
          {`${approval.botName ?? "机器人"} 想在「${approval.deviceName}」上${OPERATION_LABEL[approval.operation]}`}
        </div>
        <code className="device-approval-s">{approval.summary}</code>
        <div className="device-approval-m">
          {`${left > 0 ? `${Math.ceil(left / 1000)} 秒后自动拒绝` : "即将自动拒绝"} · 也可以在这台电脑的弹窗里处理`}
        </div>
      </div>
      <div className="device-approval-a">
        <Button
          feedback={{ pending: "处理中…", success: "已处理", error: "失败" }}
          onClick={() => void decide.run("deny")}
          size="sm"
          state={decide.state}
          variant="outline"
        >
          <IconX />
          {"拒绝"}
        </Button>
        <Button onClick={() => void decide.run("approve")} disabled={decide.state === "pending"} size="sm">
          <IconCheck />
          {"允许"}
        </Button>
      </div>
    </div>
  );
}

export function ApprovalsCard({ approvals }: { approvals: DeviceApprovalView[] }) {
  if (!approvals.length) return null;
  return (
    <Card className="device-approvals">
      <CardHeader
        description="机器人请求的操作需要你确认。允许后只执行这一次。"
        icon={<IconShieldCheck className="size-5" />}
        title={`等待你审批（${approvals.length}）`}
      />
      {approvals.map((approval) => (
        <ApprovalRow approval={approval} key={approval.id} />
      ))}
    </Card>
  );
}

export function DownloadCard({ download }: { download: PcDownload | null | undefined }) {
  const installer = download?.files.find((file) => file.kind === "installer");
  const portable = download?.files.find((file) => file.kind === "portable");
  return (
    <Card>
      <CardHeader
        action={
          installer ? (
            <Button nativeButton={false} render={<a download href={installer.url} />} size="sm">
              <IconDownload />
              {"下载安装包"}
            </Button>
          ) : undefined
        }
        description={
          download
            ? `版本 ${download.version} · Windows 10 / 11（64 位）${installer ? ` · 安装包 ${bytesText(installer.bytes)}` : ""}`
            : "安装包还没有发布到这台服务器。"
        }
        icon={<IconBrandWindows className="size-5" />}
        title="ChisaBot PC 客户端"
      />
      {portable ? (
        <SettingRow description={`解压即用，不写注册表 · ${bytesText(portable.bytes)}`} title="免安装版（zip）">
          <Button nativeButton={false} render={<a download href={portable.url} />} size="sm" variant="ghost">
            <IconDownload />
            {"下载"}
          </Button>
        </SettingRow>
      ) : null}
      {installer?.sha256 ? (
        <SettingRow description={<code className="device-code device-sha">{installer.sha256}</code>} title="SHA-256" />
      ) : null}
    </Card>
  );
}

export function AddDeviceCard() {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const download = useQuery(pcDownloadQueryOptions());
  return (
    <>
      <DownloadCard download={download.data} />
      <Card className="device-steps">
        <ol>
          <li>
            <b>{"安装并打开 PC 客户端"}</b>
            <span>{"首次打开会出现设置向导。"}</span>
          </li>
          <li>
            <b>{"填写服务器地址"}</b>
            <span className="device-step-inline">
              <code className="device-code">{origin}</code>
              <CopyButton size="sm" value={origin} variant="ghost" />
            </span>
          </li>
          <li>
            <b>{"用 ChisaBot 账号密码登录"}</b>
            <span>{"登录后这台电脑会出现在下方列表里。所有能力默认关闭，按需在这里或 PC 上打开。"}</span>
          </li>
        </ol>
      </Card>
    </>
  );
}

export function NoDevices() {
  return (
    <EmptyState
      description="安装 ChisaBot PC 客户端并登录后，机器人就能在你授权的范围内帮你操作这台电脑。"
      icon={<IconDeviceDesktop className="size-6" />}
      title="还没有设备"
    />
  );
}

const POLICIES: Array<{ value: CapabilityPolicy; label: string }> = [
  { value: "off", label: "关闭" },
  { value: "ask", label: "询问" },
  { value: "allow", label: "允许" },
];

function PolicySegmented({
  value,
  onChange,
  label,
  disabled,
}: {
  value: CapabilityPolicy;
  onChange: (value: CapabilityPolicy) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div aria-label={label} className="sg-segmented device-seg" role="radiogroup">
      {POLICIES.map((policy) => (
        <button
          aria-checked={value === policy.value}
          className={cn("sg-segmented-item", `is-${policy.value}`)}
          disabled={disabled}
          key={policy.value}
          onClick={() => onChange(policy.value)}
          role="radio"
          type="button"
        >
          {policy.label}
        </button>
      ))}
    </div>
  );
}

type Draft = {
  capabilities: DeviceCapabilities;
  allowedRoots: string[];
  botIds: string[];
  name: string;
};

function draftOf(device: DeviceView): Draft {
  return {
    capabilities: { ...device.capabilities },
    allowedRoots: [...device.allowedRoots],
    botIds: [...device.botIds],
    name: device.name,
  };
}

function sameDraft(a: Draft, b: Draft) {
  return JSON.stringify({ ...a, botIds: [...a.botIds].sort() }) === JSON.stringify({ ...b, botIds: [...b.botIds].sort() });
}

/** 权限页：能力、允许的文件夹、可用机器人、名称；改动后出现未保存栏。 */
export function DevicePermissions({ device, isThisPc = false }: { device: DeviceView; isThisPc?: boolean }) {
  const queryClient = useQueryClient();
  const base = useMemo(() => draftOf(device), [device]);
  const [draft, setDraft] = useState<Draft>(base);
  const [touched, setTouched] = useState(false);
  const [newRoot, setNewRoot] = useState("");
  const agents = useQuery(agentListQueryOptions());
  // 服务器（或 PC 上）改了配置而本页没有未保存的改动时，跟上最新值。
  useEffect(() => {
    if (!touched) setDraft(base);
  }, [base, touched]);
  const dirty = touched && !sameDraft(draft, base);
  const locked = device.revoked;

  const save = useAsyncAction(async () => {
    const next = await patchDevice(device.id, {
      capabilities: draft.capabilities,
      allowedRoots: draft.allowedRoots,
      botIds: draft.botIds,
      name: draft.name.trim() || device.name,
    });
    queryClient.setQueryData(deviceKeys.detail(device.id), next);
    void queryClient.invalidateQueries({ queryKey: deviceKeys.all });
    setTouched(false);
  });

  const update = (fn: (current: Draft) => Draft) => {
    setTouched(true);
    setDraft(fn);
  };
  const addRoots = (paths: string[]) =>
    update((current) => {
      const next = [...current.allowedRoots];
      for (const value of paths) if (!next.some((r) => r.toLowerCase() === value.toLowerCase())) next.push(value);
      return { ...current, allowedRoots: next };
    });
  const pick = useAsyncAction(async () => {
    const paths = (await pcBridge()?.pickFolders()) ?? [];
    if (paths.length) addRoots(paths);
  });
  const rootProblem =
    newRoot.trim() && !/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(newRoot.trim()) ? "请填写绝对路径，例如 C:\\Users\\你\\Documents" : null;

  return (
    <>
      <section className="device-section">
        <h2 className="device-section-t">{"能力"}</h2>
        <p className="device-section-s">{"默认全部关闭。「询问」= 每次在这台电脑的弹窗或这里确认；「允许」= 直接执行。所有操作都会记录。"}</p>
        <Card>
          {DEVICE_CAPABILITIES.map((capability) => {
            const info = CAPABILITY_INFO[capability];
            const Icon = CAP_ICON[capability];
            return (
              <SettingRow
                description={info.description}
                key={capability}
                title={
                  <span className="device-cap-t">
                    <Icon className="size-4" />
                    {info.label}
                    {info.dangerous ? <span className="device-badge is-warn is-sm">{"高风险"}</span> : null}
                  </span>
                }
              >
                <PolicySegmented
                  disabled={locked}
                  label={info.label}
                  onChange={(value) =>
                    update((current) => ({ ...current, capabilities: { ...current.capabilities, [capability]: value } }))
                  }
                  value={draft.capabilities[capability]}
                />
              </SettingRow>
            );
          })}
        </Card>
      </section>

      <section className="device-section">
        <h2 className="device-section-t">{"允许的文件夹"}</h2>
        <p className="device-section-s">{isThisPc
            ? "「读取文件」「写入文件」只能访问这些文件夹（含子文件夹）。在这台电脑上可以直接用「选择文件夹…」挑选。"
            : "「读取文件」「写入文件」只能访问这些文件夹（含子文件夹）。也可以在那台电脑的 PC 客户端里用文件夹选择器添加。"}</p>
        <Card>
          {draft.allowedRoots.length ? (
            draft.allowedRoots.map((root) => (
              <ListRow
                actions={
                  <Button
                    aria-label={`移除 ${root}`}
                    disabled={locked}
                    onClick={() => update((current) => ({ ...current, allowedRoots: current.allowedRoots.filter((r) => r !== root) }))}
                    size="icon"
                    variant="ghost"
                  >
                    <IconTrash />
                  </Button>
                }
                icon={<IconFolder className="size-5" />}
                key={root}
                title={<code className="device-path">{root}</code>}
              />
            ))
          ) : (
            <div className="device-empty-line">{"还没有允许的文件夹，文件类能力暂时用不了。"}</div>
          )}
          <form
            className="device-root-form"
            onSubmit={(event) => {
              event.preventDefault();
              const value = newRoot.trim();
              if (!value || rootProblem) return;
              addRoots([value]);
              setNewRoot("");
            }}
          >
            <Input
              aria-invalid={!!rootProblem}
              disabled={locked}
              onChange={(event) => setNewRoot(event.target.value)}
              placeholder={device.platform === "win32" ? "C:\\Users\\你\\Documents" : "/home/你/Documents"}
              value={newRoot}
            />
            <Button disabled={locked || !newRoot.trim() || !!rootProblem} size="sm" type="submit" variant="outline">
              <IconFolderPlus />
              {"添加"}
            </Button>
            {isThisPc && pcBridge() ? (
              <Button
                disabled={locked}
                feedback={{ pending: "选择中…", success: "已添加", error: "失败" }}
                onClick={() => void pick.run()}
                size="sm"
                state={pick.state}
                type="button"
              >
                <IconFolder />
                {"选择文件夹…"}
              </Button>
            ) : null}
          </form>
          {rootProblem ? <div className="device-field-error">{rootProblem}</div> : null}
        </Card>
      </section>

      <section className="device-section">
        <h2 className="device-section-t">{"可以使用这台电脑的机器人"}</h2>
        <p className="device-section-s">{"没有勾选的机器人看不到这台电脑。"}</p>
        <Card>
          {agents.isPending ? (
            <div className="device-empty-line">{"正在加载机器人…"}</div>
          ) : (agents.data ?? []).length === 0 ? (
            <div className="device-empty-line">{"还没有机器人。"}</div>
          ) : (
            (agents.data ?? []).map((agent) => {
              const checked = draft.botIds.includes(agent.id);
              return (
                <label className="device-bot-row" key={agent.id}>
                  <Checkbox
                    checked={checked}
                    disabled={locked}
                    onCheckedChange={(value) =>
                      update((current) => ({
                        ...current,
                        botIds: value ? [...current.botIds, agent.id] : current.botIds.filter((id) => id !== agent.id),
                      }))
                    }
                  />
                  <span className="device-bot-av" aria-hidden>
                    {(agent.name || "?").slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                </label>
              );
            })
          )}
        </Card>
      </section>

      <section className="device-section">
        <h2 className="device-section-t">{"名称"}</h2>
        <Card>
          <SettingRow description="在设备列表和机器人工具里显示的名字。" title="设备名称">
            <Input
              className="device-name-input"
              disabled={locked}
              maxLength={64}
              onChange={(event) => {
                const name = event.target.value;
                update((current) => ({ ...current, name }));
              }}
              value={draft.name}
            />
          </SettingRow>
        </Card>
      </section>

      <SaveBar show={dirty || save.state !== "idle"}>
        <Button
          disabled={save.state === "pending"}
          onClick={() => {
            setDraft(base);
            setTouched(false);
          }}
          size="sm"
          variant="ghost"
        >
          {"放弃"}
        </Button>
        <Button feedback="save" onClick={() => void save.run()} size="sm" state={save.state}>
          {"保存"}
        </Button>
      </SaveBar>
    </>
  );
}

function actorText(entry: DeviceAuditEntry) {
  if (entry.actorType === "bot") return entry.actorName ?? "机器人";
  if (entry.actorType === "device") return "PC 客户端";
  if (entry.actorType === "user") return entry.actorName ? `${entry.actorName}（网页）` : "网页";
  return "系统";
}

export function AuditList({ entries }: { entries: DeviceAuditEntry[] }) {
  if (!entries.length) return <div className="device-empty-line">{"还没有任何操作记录。"}</div>;
  return (
    <div className="device-audit">
      {entries.map((entry) => {
        const outcome = OUTCOME_LABEL[entry.outcome] ?? { text: entry.outcome, tone: "muted" as const };
        const action =
          ACTION_LABEL[entry.action] ?? (entry.action in OPERATION_LABEL ? OPERATION_LABEL[entry.action as keyof typeof OPERATION_LABEL] : entry.action);
        return (
          <div className="device-audit-row" key={entry.id}>
            <time className="device-audit-time" dateTime={entry.at}>
              {new Date(entry.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </time>
            <div className="min-w-0 flex-1">
              <div className="device-audit-t">
                <b>{actorText(entry)}</b>
                <span>{action}</span>
              </div>
              {entry.summary ? <div className="device-audit-s">{entry.summary}</div> : null}
              {entry.detail ? <div className="device-audit-d">{entry.detail}</div> : null}
            </div>
            <div className="device-audit-r">
              <span className={cn("device-badge is-sm", `is-${outcome.tone}`)}>{outcome.text}</span>
              {entry.durationMs !== null ? <span className="device-audit-ms">{`${entry.durationMs} ms`}</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 「本机」标签：只在 PC 客户端里、而且看的正是这台电脑时出现（DESIGN.md §16.4）。这些设置只存在这台电脑上，
 * 通过 PC 客户端的本机桥读写；放松安全的改动由 PC 弹出本机确认窗，用户在那里取消时这里的开关回到原位。
 */
export function ThisPcPanel({ local, onLocal }: { local: PcLocalState; onLocal: (next: PcLocalState) => void }) {
  const bridge = pcBridge();
  const [busy, setBusy] = useState<string | null>(null);
  const logout = useAsyncAction(async () => {
    await bridge?.logout();
  });
  const set = async (key: keyof PcLocalPatch, value: boolean) => {
    if (!bridge) return;
    setBusy(key);
    try {
      onLocal(await bridge.setLocal({ [key]: value }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "修改失败");
    } finally {
      setBusy(null);
    }
  };
  const online = local.agentState === "online";
  return (
    <>
      <section className="device-section">
        <h2 className="device-section-t">{"这台电脑"}</h2>
        <p className="device-section-s">{"这些设置只保存在这台电脑上，网页和手机看不到也改不了。放松安全的改动需要在这台电脑上再确认一次。"}</p>
        <Card>
          <SettingRow
            description={`${local.serverUrl} · 客户端 ${local.version} · ${local.hostname}`}
            title="节点连接"
          >
            <span className={cn("device-badge", online ? "is-ok" : local.localPaused ? "is-danger" : local.agentState === "revoked" ? "is-muted" : "is-warn")}>
              {online ? <span aria-hidden className="device-dot is-ok" /> : null}
              {local.statusText}
            </span>
          </SettingRow>
          <SettingRow
            description="立即拒绝一切远程操作、取消进行中的操作和审批；断网时也有效。也可以在托盘菜单里按。"
            title={
              <span className="device-cap-t">
                <IconPlayerStopFilled className="size-4 text-[var(--danger)]" />
                {"本机紧急停止"}
              </span>
            }
          >
            <Switch
              aria-label="本机紧急停止"
              checked={local.localPaused}
              disabled={busy === "localPaused"}
              onCheckedChange={(value) => void set("localPaused", value)}
            />
          </SettingRow>
          <SettingRow
            description="命令行、写入文件、鼠标键盘即使在权限里设为「允许」，也先在这台电脑上弹窗确认。服务器被攻破也无法静默操作这台电脑。"
            title={
              <span className="device-cap-t">
                <IconShieldCheck className="size-4" />
                {"高风险操作始终在本机确认"}
                <span className="device-badge is-ok is-sm">{"推荐"}</span>
              </span>
            }
          >
            <Switch
              aria-label="高风险操作始终在本机确认"
              checked={local.forceLocalApproval}
              disabled={busy === "forceLocalApproval"}
              onCheckedChange={(value) => void set("forceLocalApproval", value)}
            />
          </SettingRow>
          <SettingRow description="登录 Windows 后自动启动 ChisaBot PC，保持节点在线。" title="开机自动启动">
            <Switch
              aria-label="开机自动启动"
              checked={local.autoStart}
              disabled={busy === "autoStart"}
              onCheckedChange={(value) => void set("autoStart", value)}
            />
          </SettingRow>
          <SettingRow description="启动时不打开窗口，只在托盘里运行。" title="启动时隐藏到托盘">
            <Switch
              aria-label="启动时隐藏到托盘"
              checked={local.startHidden}
              disabled={busy === "startHidden"}
              onCheckedChange={(value) => void set("startHidden", value)}
            />
          </SettingRow>
          <SettingRow
            description={local.tokenProtected ? "已用 Windows 数据保护（DPAPI）加密，只有当前 Windows 用户能解开。" : "这台电脑不支持系统加密，令牌以普通文件保存。"}
            title="设备令牌"
          >
            <span className={cn("device-badge", local.tokenProtected ? "is-ok" : "is-warn")}>{local.tokenProtected ? "已加密" : "未加密"}</span>
          </SettingRow>
        </Card>
      </section>
      <section className="device-section">
        <h2 className="device-section-t is-danger">{"账号"}</h2>
        <Card className="device-danger">
          <SettingRow description="作废这台电脑的设备令牌、清除登录状态，回到设置向导。可以换一台服务器或换个账号重新登录。" title="退出登录 / 换服务器">
            <Button feedback={{ pending: "等待确认…", success: "已退出", error: "失败" }} onClick={() => void logout.run()} size="sm" state={logout.state} variant="destructive">
              {"退出登录"}
            </Button>
          </SettingRow>
        </Card>
      </section>
    </>
  );
}
