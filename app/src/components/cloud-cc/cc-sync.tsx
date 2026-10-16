import { IconAlertTriangle, IconChevronDown, IconCloud, IconDeviceDesktop, IconFolder, IconFolderOpen, IconGitBranch, IconRefresh } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { type CcSyncState, type CcWorkspaceView, SYNC_STATE_ZH } from "../../../../shared/cloud-cc";
import { useAsyncAction } from "@/components/ui/async-action";
import { Button, T } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { confirmDialog } from "@/components/ui/confirm";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { ccApi, ccKeys, ccSyncQueryOptions } from "@/lib/cloud-cc";
import { type PcFolderInfo, type PcSyncBinding, type PcSyncChoice, pcSyncBridge, usePcSync } from "@/lib/pc-bridge";
import { cn } from "@/lib/utils";

/**
 * 电脑文件夹同步的界面（P4b，docs/cloud-claude-code.md §2.3 / §2.5 / §4，DESIGN.md §73.9）：
 *  - CcSyncPillButton：可以点的同步状态药丸（对话头），点开同步面板。
 *  - CcSyncDialog：同步面板。PC 客户端里能开关同步、立即同步、交还云端、打开文件夹、处理冲突；网页 / 手机只读，
 *    电脑离线时多一个「强制收回到云端」，有冲突时写「去电脑上处理」。
 *  - CcConflictDialog（只在 PC 上）：每个文件「用云端 / 用电脑 / 两份都留」，Git 分叉「以云端为准 / 在电脑上合并后再试」。
 *  - CcLocalFolderPane：新建工作区里的「电脑上的文件夹」（只在 PC 客户端里能选）。
 *  - CcSyncWatcher：PC 上有工作区进入冲突时自动弹冲突对话框（每次冲突只弹一次）。
 */

export function fmtBytes(n: number | null | undefined) {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
function ago(iso: string | null | undefined) {
  if (!iso) return "还没有同步过";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.round(s / 3600)} 小时前`;
  return new Date(iso).toLocaleString("zh-CN", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
const TONE: Record<CcSyncState, string> = { cloud_only: "", syncing: "is-info", pc_active: "is-ok", paused: "is-warn", conflict: "is-danger" };

/** 药丸 + 按钮（对话头、同步面板标题旁）。 */
export function CcSyncPillButton({ ws, className }: { ws: CcWorkspaceView; className?: string }) {
  const [open, setOpen] = useState(false);
  if (ws.source === "scratch") return null;
  return (
    <>
      <button
        aria-label={`电脑同步：${SYNC_STATE_ZH[ws.syncState]}`}
        className={cn("cc-pill cc-sync-pill is-btn", TONE[ws.syncState], className)}
        data-state={ws.syncState}
        data-testid="cc-sync-pill"
        onClick={() => setOpen(true)}
        type="button"
      >
        <i aria-hidden className="cc-dot" />
        <T>{SYNC_STATE_ZH[ws.syncState]}</T>
      </button>
      <CcSyncDialog onOpenChange={setOpen} open={open} ws={ws} />
    </>
  );
}

function IgnoreRules({ rules: given }: { rules: string[] }) {
  const [open, setOpen] = useState(false);
  const rules = given.length ? given : DEFAULT_RULES;
  return (
    <div className="cc-sync-rules" data-open={open ? "" : undefined}>
      <button aria-expanded={open} className="cc-sync-rules-h" onClick={() => setOpen((o) => !o)} type="button">
        <IconChevronDown className="size-3.5" />
        {"不同步的规则"}
        <span className="cc-sync-rules-n">{`${rules.filter((r) => !r.startsWith("!")).length} 条`}</span>
      </button>
      {open ? (
        <div className="cc-sync-rules-b">
          <p>{"这些文件和目录不会上云，也不会从云端下来（.git 由 Git 自己同步）。已经被 Git 跟踪的构建产物照样同步。"}</p>
          <div className="cc-sync-chips">
            {rules.map((r) => (
              <code className={cn("cc-sync-chip", r.startsWith("!") && "is-keep")} key={r}>
                {r.startsWith("!") ? `${r.slice(1)}（例外，会同步）` : r}
              </code>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const DEFAULT_RULES = ["node_modules", ".env", ".env.*", "!.env.example", "!.env.sample", "dist", "build", "out", ".next", "coverage", ".cache", "cache", ".tmp", ".venv", "venv", "__pycache__"];

/** 同步面板（图 4 左 / 网页上的只读版）。 */
export function CcSyncDialog({ ws, open, onOpenChange }: { ws: CcWorkspaceView; open: boolean; onOpenChange: (open: boolean) => void }) {
  const view = useQuery(ccSyncQueryOptions(ws.id, open));
  const pc = usePcSync();
  const bridge = pcSyncBridge();
  const local = pc?.bindings.find((b) => b.workspaceId === ws.id) ?? null;
  const queryClient = useQueryClient();
  const [conflictOpen, setConflictOpen] = useState(false);
  const [picked, setPicked] = useState<PcFolderInfo | null>(null);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ccKeys.workspaces });
    await queryClient.invalidateQueries({ queryKey: ["claude-code", "sync", ws.id] });
  };
  const state = (view.data?.state ?? ws.syncState) as CcSyncState;
  const b = view.data?.binding ?? null;
  const thisPc = !!local && !!b && local.enabled && b.enabled;

  const reclaim = useAsyncAction(
    async () => {
      await ccApi.forceReclaim(ws.id);
      await refresh();
    },
    { errorToast: (e) => `强制收回失败：${e.message}` },
  );
  const askReclaim = async () => {
    const ok = await confirmDialog({
      title: "强制收回到云端？",
      description: `「${b?.deviceName ?? "那台电脑"}」离线了。收回后工作区变成「已暂停」，云端可以直接写工作目录；电脑上还没同步上来的改动留在电脑上，下次开启同步时会先对比，两边都改过的文件让你选，不会被覆盖。`,
      confirmLabel: "强制收回",
      destructive: true,
    });
    if (ok) void reclaim.run();
  };
  const syncNow = useAsyncAction(async () => {
    await bridge!.syncNow(ws.id);
    await refresh();
  }, { errorToast: (e) => `同步失败：${e.message}` });
  const release = useAsyncAction(
    async () => {
      await bridge!.release(ws.id);
      await refresh();
    },
    { errorToast: (e) => `交还失败：${e.message}` },
  );
  const askRelease = async () => {
    const ok = await confirmDialog({
      title: "交还云端（关闭同步）？",
      description: "会先把这台电脑上的改动传上去，然后暂停同步。两份都保留：电脑上的文件夹不会被删，以后可以再开启，开启时先对比两边。",
      confirmLabel: "交还云端",
    });
    if (ok) void release.run();
  };
  const pick = useAsyncAction(async () => {
    const info = await bridge!.pick({ forEnable: true });
    if (info) setPicked(info);
  }, { errorToast: (e) => e.message });
  const enable = useAsyncAction(
    async () => {
      await bridge!.enable({ workspaceId: ws.id, path: picked?.path ?? null, name: ws.name, source: ws.source });
      setPicked(null);
      await refresh();
    },
    { errorToast: (e) => `开启同步失败：${e.message}` },
  );

  let headline = "没有绑定电脑 · 只在云端";
  const offlineMin = b?.offlineMs ? Math.max(1, Math.round(b.offlineMs / 60_000)) : null;
  if (b?.enabled && state === "conflict") headline = `「${b.deviceName}」上有冲突${!b.online && offlineMin ? ` · 离线 ${offlineMin} 分钟` : ""}`;
  else if (b?.enabled && b.online) headline = state === "pc_active" ? `在「${b.deviceName}」上同步中` : `「${b.deviceName}」${SYNC_STATE_ZH[state]}`;
  else if (b?.enabled) headline = `「${b.deviceName}」离线 ${offlineMin ?? "?"} 分钟`;
  else if (b) headline = `已暂停 · 上次在「${b.deviceName}」`;

  const busyText = local?.busy;
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="cc-dlg sm:max-w-[500px]" data-testid="cc-sync-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {"电脑同步"}
            <span className={cn("cc-pill cc-sync-pill", TONE[state])} data-state={state}>
              <i aria-hidden className="cc-dot" />
              <T>{SYNC_STATE_ZH[state]}</T>
            </span>
          </DialogTitle>
          <DialogDescription>{`工作区「${ws.name}」。云端是主副本；同一时间最多一台电脑在用，关闭同步不删任何东西。`}</DialogDescription>
        </DialogHeader>
        <DialogBody className="mt-4 overflow-y-auto">
          {view.isPending ? (
            <div aria-busy className="cc-repo-skel" />
          ) : view.isError ? (
            <p className="cc-form-err">{view.error.message}</p>
          ) : (
            <>
              <section className="cc-sync-card" data-testid="cc-sync-status">
                <span aria-hidden className={cn("cc-sync-ico", TONE[state])}>
                  {b?.enabled ? <IconDeviceDesktop className="size-5" /> : <IconCloud className="size-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="cc-sync-t" data-testid="cc-sync-headline">
                    {headline}
                  </div>
                  <div className="cc-sync-s">
                    {[b?.label ? `电脑上的路径 ${b.label}` : null, b?.enabled ? `上次同步 ${ago(b.lastSyncedAt)}` : null, view.data?.handoff ? "云端正在写入工作目录（交接中）" : null, b?.detail && state !== "pc_active" ? b.detail : null]
                      .filter(Boolean)
                      .join(" · ") || "在 ChisaBot PC 客户端里可以把它同步到电脑上的一个文件夹。"}
                  </div>
                </div>
              </section>
              {state === "conflict" && view.data?.conflicts.length ? (
                <section className="cc-sync-conf" data-testid="cc-sync-conflicts">
                  <IconAlertTriangle className="size-4 flex-none" />
                  <div className="min-w-0">
                    <div className="cc-sync-t">{thisPc ? "两边都改过这些文件，要你选" : "去电脑上处理"}</div>
                    <div className="cc-sync-s">{view.data.conflicts.slice(0, 5).join("、") + (view.data.conflicts.length > 5 ? ` 等 ${view.data.conflicts.length} 个` : "")}</div>
                  </div>
                </section>
              ) : null}

              {bridge && pc ? (
                !pc.available ? (
                  <p className="cc-sync-note" data-testid="cc-sync-unavailable">{`这台电脑现在不能同步：${pc.reason ?? "同步组件没有启动"}`}</p>
                ) : thisPc && local ? (
                  <section className="cc-sync-local" data-testid="cc-sync-local">
                    <div className="cc-sync-row">
                      <IconFolder className="size-4 flex-none opacity-70" />
                      <span className="cc-sync-path" title={local.path}>
                        {local.path}
                      </span>
                      <button className="cc-sync-link" onClick={() => void bridge.openFolder(ws.id).catch((e: Error) => toast.error(e.message))} type="button">
                        {"打开"}
                      </button>
                    </div>
                    <div className="cc-sync-row is-sub">
                      <span>{`${local.files ?? "?"} 个文件 · ${fmtBytes(local.bytes)}`}</span>
                      <span>
                        <IconGitBranch className="mr-1 inline size-3.5 align-[-2px]" />
                        {local.gitConflict ? "Git 分叉" : local.git?.note ? local.git.note : local.git?.branch ? `${local.git.branch} · ${local.git.result === "same" || local.git.result === "fast_forward" || local.git.result === "adopted" || local.git.result === "pulled" ? "和云端一致" : (local.git.result ?? "")}` : "不是 Git 仓库"}
                      </span>
                    </div>
                    {busyText ? <div className="cc-sync-busy">{busyText}</div> : null}
                  </section>
                ) : (
                  <section className="cc-sync-local" data-testid="cc-sync-enable">
                    {b?.enabled && !thisPc ? (
                      <p className="cc-sync-note">{`「${b.deviceName}」正在用这个工作区。先在那台电脑上「交还云端」，它离线的话可以强制收回。`}</p>
                    ) : local ? (
                      <div className="cc-sync-row">
                        <IconFolder className="size-4 flex-none opacity-70" />
                        <span className="cc-sync-path">{local.path}</span>
                        <span className="cc-sync-s">{"再次开启时先对比两边"}</span>
                      </div>
                    ) : picked ? (
                      <div className="cc-sync-row">
                        <IconFolderOpen className="size-4 flex-none opacity-70" />
                        <span className="cc-sync-path">{picked.path}</span>
                        <span className="cc-sync-s">{picked.empty ? "空文件夹：从云端下载" : `已有 ${picked.files} 个文件：先对比两边`}</span>
                      </div>
                    ) : (
                      <p className="cc-sync-note">{"选一个空文件夹，云端的工作目录会下载到这里，之后两边实时同步。选已有文件的文件夹时先对比，两边都改过的文件让你选。"}</p>
                    )}
                  </section>
                )
              ) : !bridge ? (
                <p className="cc-sync-note">{"在 ChisaBot PC 客户端（Windows）里打开这个面板，可以开启或关闭同步。"}</p>
              ) : null}
              <IgnoreRules rules={local?.ignores ?? pc?.ignores ?? DEFAULT_RULES} />
            </>
          )}
        </DialogBody>
        <DialogFooter className="mt-6 flex-wrap">
          {view.data?.canForceReclaim && !thisPc ? (
            <Button data-testid="cc-sync-reclaim" feedback={{ pending: "收回中…", success: "已收回", error: "没收回" }} onClick={() => void askReclaim()} state={reclaim.state} variant="destructive">
              {"强制收回到云端"}
            </Button>
          ) : null}
          {bridge && pc?.available && thisPc ? (
            <>
              {state === "conflict" ? (
                <Button data-testid="cc-sync-open-conflicts" onClick={() => setConflictOpen(true)} variant="destructive">
                  {"处理冲突"}
                </Button>
              ) : null}
              <Button data-testid="cc-sync-release" feedback={{ pending: "交还中…", success: "已交还", error: "没交还" }} onClick={() => void askRelease()} state={release.state} variant="outline">
                {"交还云端（关闭同步）"}
              </Button>
              <Button data-testid="cc-sync-now" disabled={state === "conflict"} feedback={{ pending: busyText ?? "同步中…", success: "已同步", error: "同步失败" }} onClick={() => void syncNow.run()} state={syncNow.state}>
                <IconRefresh className="size-4" />
                {"立即同步"}
              </Button>
            </>
          ) : bridge && pc?.available && !(b?.enabled && !thisPc) ? (
            <>
              {!local ? (
                <Button data-testid="cc-sync-pick" feedback={{ pending: "选择中…", success: "已选好", error: "没选成" }} onClick={() => void pick.run()} state={pick.state} variant="outline">
                  <IconFolderOpen className="size-4" />
                  {picked ? "换一个文件夹" : "选择文件夹"}
                </Button>
              ) : null}
              <Button
                data-testid="cc-sync-enable-btn"
                disabled={!local && !picked}
                feedback={{ pending: busyText ?? "开启中…", success: "已开启", error: "没开启" }}
                onClick={() => void enable.run()}
                state={enable.state}
              >
                {local ? "再次开启同步" : "在这台电脑上开启同步"}
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)} variant="outline">
              {"关闭"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
      {local ? <CcConflictDialog binding={local} onOpenChange={setConflictOpen} open={conflictOpen} /> : null}
    </Dialog>
  );
}

/** 冲突对话框（图 4 右，只在 PC 上）。 */
export function CcConflictDialog({ binding, open, onOpenChange }: { binding: PcSyncBinding; open: boolean; onOpenChange: (open: boolean) => void }) {
  const bridge = pcSyncBridge();
  const queryClient = useQueryClient();
  const [doing, setDoing] = useState<string | null>(null);
  const files = binding.conflicts;
  const done = !files.length && !binding.gitConflict && !binding.unconfirmed;
  useEffect(() => {
    if (open && done && binding.state !== "conflict") {
      const t = setTimeout(() => onOpenChange(false), 900);
      return () => clearTimeout(t);
    }
  }, [open, done, binding.state, onOpenChange]);
  const act = useAsyncAction(
    async (path: string, choice: PcSyncChoice) => {
      setDoing(`${path}|${choice}`);
      try {
        await bridge!.resolve({ workspaceId: binding.workspaceId, path, choice });
        await queryClient.invalidateQueries({ queryKey: ccKeys.workspaces });
      } finally {
        setDoing(null);
      }
    },
    { errorToast: (e) => `没处理成：${e.message}` },
  );
  const later = useAsyncAction(async () => {
    await bridge!.release(binding.workspaceId);
    await queryClient.invalidateQueries({ queryKey: ccKeys.workspaces });
    onOpenChange(false);
  }, { errorToast: (e) => e.message });
  const btn = (path: string, choice: PcSyncChoice, label: string, variant: "outline" | "default" = "outline") => (
    <Button
      data-testid={`cc-conf-${choice}`}
      disabled={act.state === "pending" && doing !== `${path}|${choice}`}
      feedback={{ pending: "处理中…", success: "已处理", error: "没处理成" }}
      onClick={() => void act.run(path, choice)}
      size="sm"
      state={doing === `${path}|${choice}` ? act.state : "idle"}
      variant={variant}
    >
      {label}
    </Button>
  );
  return (
    <Dialog onOpenChange={(o) => (act.state === "pending" ? undefined : onOpenChange(o))} open={open}>
      <DialogContent className="cc-dlg sm:max-w-[560px]" data-testid="cc-conflict-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconAlertTriangle className="size-5 text-[var(--danger)]" />
            {"同步冲突"}
          </DialogTitle>
          <DialogDescription>{`工作区「${binding.name}」。两边都改过的文件不会被自动覆盖，每个文件选一次。挪走的那份放进备份，不会删掉。`}</DialogDescription>
        </DialogHeader>
        <DialogBody className="mt-4 overflow-y-auto">
          {done ? (
            <p className="cc-sync-ok" data-testid="cc-conf-done">
              {"都处理好了，同步已恢复。"}
            </p>
          ) : null}
          {binding.unconfirmed ? (
            <section className="cc-conf-row" data-testid="cc-conf-handoff">
              <div className="cc-conf-p">{"交接未确认"}</div>
              <div className="cc-conf-s">{"上次云端写入工作目录时这台电脑断开了，交接记录对不上，所以同步保持暂停。重新对比两边：只有一边改过的自动带过去，两边都改过的再让你选。"}</div>
              <div className="cc-conf-a">{btn("", "handoff_retry", "重新对比两边", "default")}</div>
            </section>
          ) : null}
          {binding.gitConflict ? (
            <section className="cc-conf-row" data-testid="cc-conf-git">
              <div className="cc-conf-p">
                <IconGitBranch className="mr-1 inline size-4 align-[-3px]" />
                {`Git · ${binding.git?.branch ?? "当前分支"}`}
              </div>
              <div className="cc-conf-s">{`${binding.gitConflict}。不会自动合并。`}</div>
              <div className="cc-conf-a">
                {btn(".git", "git_cloud", "以云端为准（电脑上的提交先备份）")}
                {btn(".git", "git_retry", "我在电脑上合并好了，再试")}
              </div>
            </section>
          ) : null}
          {files.map((f) => (
            <section className="cc-conf-row" data-testid="cc-conf-file" key={f.path}>
              <div className="cc-conf-p" title={f.path}>
                {f.path}
              </div>
              <div className="cc-conf-s">{f.kind === "deleted" ? "一边删了、另一边改了" : "云端和电脑上都改过"}</div>
              <div className="cc-conf-a">
                {btn(f.path, "cloud", "用云端")}
                {btn(f.path, "pc", "用电脑")}
                {btn(f.path, "both", "两份都留")}
              </div>
            </section>
          ))}
          {!done ? <p className="cc-sync-note">{"「两份都留」：电脑上那份另存为「文件名.电脑副本.扩展名」，云端那份留在原名。"}</p> : null}
        </DialogBody>
        <DialogFooter className="mt-6">
          <Button data-testid="cc-conf-later" feedback={{ pending: "交还中…", success: "已暂停", error: "没交还" }} onClick={() => void later.run()} state={later.state} variant="outline">
            {"先不同步（交还云端）"}
          </Button>
          <Button onClick={() => onOpenChange(false)}>{done ? "完成" : "稍后处理"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** PC 上有工作区进入冲突时自动弹一次冲突对话框（图 4：进入「冲突」时 PC 上弹冲突对话框）。 */
export function CcSyncWatcher() {
  const pc = usePcSync();
  const [shown, setShown] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const current = pc?.bindings.find((b) => b.workspaceId === open) ?? null;
  useEffect(() => {
    if (!pc || open) return;
    for (const b of pc.bindings) {
      if (!b.enabled || b.state !== "conflict") continue;
      const sig = `${b.conflicts.map((c) => c.path).join("|")}#${b.gitConflict ?? ""}#${b.unconfirmed}`;
      if (shown[b.workspaceId] === sig) continue;
      setShown((s) => ({ ...s, [b.workspaceId]: sig }));
      setOpen(b.workspaceId);
      return;
    }
  }, [pc, open, shown]);
  if (!current) return null;
  return <CcConflictDialog binding={current} onOpenChange={(o) => !o && setOpen(null)} open />;
}

/** 新建工作区 →「电脑上的文件夹」（图 2 右，只在 PC 客户端里）。 */
export function CcLocalFolderPane({ onBusy, onDone }: { onBusy: (busy: boolean) => void; onDone: () => void }) {
  const bridge = pcSyncBridge();
  const pc = usePcSync();
  const [info, setInfo] = useState<PcFolderInfo | null>(null);
  const [name, setName] = useState("");
  const [enableSync, setEnableSync] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const progress = useMemo(() => (info ? (pc?.bindings.find((b) => b.path === info.path)?.busy ?? null) : null), [pc, info]);
  const pick = useAsyncAction(async () => {
    setError(null);
    const r = await bridge!.pick();
    if (r) {
      setInfo(r);
      setName(r.name);
    }
  }, { errorToast: (e) => e.message });
  const create = useAsyncAction(
    async () => {
      if (!info) throw new Error("先选一个文件夹");
      setError(null);
      onBusy(true);
      try {
        const r = await bridge!.create({ path: info.path, name: name.trim() || info.name, enableSync });
        await queryClient.invalidateQueries({ queryKey: ccKeys.workspaces });
        const session = await ccApi.createSession(r.workspace.id);
        await queryClient.invalidateQueries({ queryKey: ccKeys.workspaces });
        setTimeout(() => {
          onDone();
          void navigate({ to: "/cc/$sessionId", params: { sessionId: session.id } });
        }, 900);
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        onBusy(false);
      }
    },
    { errorToast: false },
  );
  if (!bridge) return null;
  if (pc && !pc.available) return <p className="cc-sync-note" data-testid="cc-local-unavailable">{`这台电脑现在不能同步：${pc.reason ?? "同步组件没有启动"}`}</p>;
  return (
    <div className="cc-local" data-testid="cc-local-pane">
      {!info ? (
        <div className="cc-gh-empty">
          <IconFolderOpen className="size-6 opacity-70" />
          <div className="cc-gh-empty-t">{"选一个电脑上的文件夹"}</div>
          <div className="cc-gh-empty-s">{"先上传到云端（云端是主副本），之后可以在这台电脑上一直同步：两边谁改都会带过去，两边都改过的文件让你选。"}</div>
          <Button data-testid="cc-local-pick" feedback={{ pending: "选择中…", success: "已选好", error: "没选成" }} onClick={() => void pick.run()} size="sm" state={pick.state}>
            {"选择文件夹"}
          </Button>
        </div>
      ) : (
        <>
          <section className="cc-sync-card" data-testid="cc-local-info">
            <span aria-hidden className="cc-sync-ico is-info">
              <IconFolder className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="cc-sync-t cc-sync-path" title={info.path}>
                {info.path}
              </div>
              <div className="cc-sync-s">
                {`${info.files.toLocaleString("zh-CN")}${info.truncated ? "+" : ""} 个文件 · ${fmtBytes(info.bytes)} · `}
                {info.git.repo ? `Git 仓库${info.git.branch ? ` · ${info.git.branch}` : ""}${info.git.remote ? ` · ${info.git.remote.replace(/^https?:\/\//, "")}` : ""}` : "不是 Git 仓库"}
              </div>
              {info.skipped.length ? <div className="cc-sync-s">{`不会上传：${info.skipped.map((s) => s.name).slice(0, 6).join("、")}${info.skipped.length > 6 ? " 等" : ""}`}</div> : null}
            </div>
            <button className="cc-sync-link" data-testid="cc-local-repick" onClick={() => void pick.run()} type="button">
              {"换一个"}
            </button>
          </section>
          {info.big ? (
            <p className="cc-sync-warn" role="note">
              {"这个文件夹超过 2 GB 或 5 万个文件，第一次上传会比较久。可以继续，也可以换一个小一点的文件夹。"}
            </p>
          ) : null}
          {info.bound ? <p className="cc-form-err">{"这个文件夹已经在同步一个工作区了。"}</p> : null}
          <IgnoreRules rules={info.ignores} />
          <label className="cc-field">
            <span className="cc-field-l">{"名称"}</span>
            <Input data-testid="cc-local-name" onChange={(e) => setName(e.target.value)} placeholder={info.name} value={name} />
          </label>
          <label className="cc-local-check">
            <Checkbox checked={enableSync} data-testid="cc-local-sync" onCheckedChange={(v) => setEnableSync(!!v)} />
            <span>{"传完后在这台电脑上开启同步（之后随时可以关）"}</span>
          </label>
          {error ? (
            <p className="cc-form-err" role="alert">
              {error}
            </p>
          ) : null}
          <div className="cc-local-foot">
            <Button
              data-testid="cc-local-create"
              disabled={!!info.bound}
              feedback={{ pending: progress ?? "上传中…", success: "已创建", error: "没有建成" }}
              onClick={() => void create.run()}
              state={create.state}
            >
              {"上传并创建"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
