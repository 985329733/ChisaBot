import { IconDots, IconKey, IconLink, IconPlayerPause, IconPlayerPlay, IconPlus, IconTrash, IconUser, IconUserShield } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageEmpty, PageSection, PageShell, PageSkeleton } from "@/components/layout/page-shell";
import { useAsyncAction } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Card, ErrorCard, ListRow } from "@/components/ui/skyglass";
import { toast } from "@/components/ui/toast";
import {
  accountKeys,
  accountsQueryOptions,
  createInvite,
  deleteAccount,
  expiresText,
  type GatewayAccount,
  type GatewayInvite,
  lastSeenText,
  resetAccount,
  revokeInvite,
  setAccountDisabled,
} from "@/lib/accounts";

export const Route = createFileRoute("/_authed/admin/accounts")({
  component: AccountsPage,
});

/**
 * 设置 → 管理 → 账号（CB-040，DESIGN.md §65）：邀请朋友、停用、重置密码。
 * 每个账号的机器人、对话、记忆、密钥、设备都是分开的；朋友看不到你的任何东西。
 */
function AccountsPage() {
  const list = useQuery(accountsQueryOptions());
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [link, setLink] = useState<{ title: string; url: string; expiresAt: number } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: accountKeys.all });

  async function toggle(account: GatewayAccount) {
    if (!account.disabled) {
      const ok = await confirmDialog({
        title: `停用「${account.displayName}」？`,
        description: "停用后他立刻退出所有设备（网页、PC、手机），也不能再登录。他的机器人和数据都保留，随时可以恢复。",
        confirmLabel: "停用",
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      await setAccountDisabled(account.id, !account.disabled);
      await refresh();
      toast.success(account.disabled ? `已恢复「${account.displayName}」` : `已停用「${account.displayName}」`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    }
  }
  async function reset(account: GatewayAccount) {
    const ok = await confirmDialog({
      title: `给「${account.displayName}」重置密码？`,
      description: "会生成一个 24 小时内有效的链接，发给他，他打开后设新密码；设好后旧密码和所有已登录的设备都会失效。",
      confirmLabel: "生成链接",
    });
    if (!ok) return;
    try {
      const invite = await resetAccount(account.id);
      await refresh();
      setLink({ title: `「${account.displayName}」的重置密码链接`, url: invite.url, expiresAt: invite.expiresAt });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    }
  }
  async function remove(account: GatewayAccount) {
    const ok = await confirmDialog({
      title: `删除账号「${account.displayName}」？`,
      description: "他会立刻退出、不能再登录，账号名可以重新使用。他在 ChisaBot 里的机器人和对话不会被删除（只是没人能再登录看到）。不能撤销。",
      confirmLabel: "删除",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteAccount(account.id);
      await refresh();
      toast.success(`已删除「${account.displayName}」`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    }
  }
  async function revoke(invite: GatewayInvite) {
    try {
      await revokeInvite(invite.id);
      await refresh();
      toast.success("链接已作废");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    }
  }

  const data = list.data;
  const accounts = data?.available ? data.accounts : [];
  const invites = data?.available ? data.invites : [];
  const nameOf = (id: string | null) => accounts.find((a) => a.id === id)?.displayName ?? "账号";
  return (
    <>
      <InviteDialog
        onCreated={(invite) => {
          void refresh();
          setInviteOpen(false);
          setLink({ title: "邀请链接", url: invite.url, expiresAt: invite.expiresAt });
        }}
        onOpenChange={setInviteOpen}
        open={inviteOpen}
      />
      <LinkDialog link={link} onOpenChange={(open) => (open ? null : setLink(null))} />
      <PageShell
        action={
          data?.available ? (
            <Button onClick={() => setInviteOpen(true)} size="sm">
              <IconPlus />
              {"邀请朋友"}
            </Button>
          ) : null
        }
        description="把 ChisaBot 分享给朋友：发一个邀请链接，他自己设账号名和密码。每个账号的机器人、对话、记忆、密钥、页面和设备都是分开的，朋友看不到你的任何东西，管理页也只有你能进。"
        title="账号"
      >
        {list.isPending ? (
          <PageSkeleton rows={2} />
        ) : list.isError ? (
          <ErrorCard
            action={
              <Button className="mt-2" onClick={() => void list.refetch()} size="sm" variant="outline">
                {"重试"}
              </Button>
            }
            description={list.error.message}
            title="账号列表暂时无法读取"
          />
        ) : !data?.available ? (
          <PageEmpty>{data?.reason ?? "不可用"}</PageEmpty>
        ) : (
          <>
            <PageSection title={`账号 · ${accounts.length}`}>
              <Card className="mem-card">
                {accounts.map((account) => (
                  <div className="im-row" key={account.id}>
                    <div className="im-row-main">
                      <ListRow
                        icon={
                          <span className="mem-ico is-project">
                            {account.role === "admin" ? <IconUserShield className="size-5" /> : <IconUser className="size-5" />}
                          </span>
                        }
                        sub={
                          <>
                            <span className="device-row-meta">
                              <span className="skill-slug">{account.username}</span>
                              <span className="device-cap-chip">{account.role === "admin" ? "管理员" : "朋友"}</span>
                              {account.disabled ? <span className="device-cap-chip is-off">{"已停用"}</span> : null}
                              {account.id === data.me ? <span className="device-cap-chip">{"你"}</span> : null}
                            </span>
                            <span className="mem-by">{account.builtin ? "内置管理员 · 在服务器配置里改密码" : lastSeenText(account.lastLoginAt)}</span>
                          </>
                        }
                        title={account.displayName}
                      />
                    </div>
                    {account.builtin ? null : (
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<button aria-label={`「${account.displayName}」的更多操作`} className="device-row-more" title={"更多操作"} type="button" />}>
                          <IconDots className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="glass-pop w-[200px] p-1.5">
                          <DropdownMenuItem className="glass-mi" onClick={() => void reset(account)}>
                            <IconKey className="size-[18px] shrink-0 opacity-80" />
                            <span className="min-w-0 flex-1">{"重置密码…"}</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem className="glass-mi" onClick={() => void toggle(account)}>
                            {account.disabled ? <IconPlayerPlay className="size-[18px] shrink-0 opacity-80" /> : <IconPlayerPause className="size-[18px] shrink-0 opacity-80" />}
                            <span className="min-w-0 flex-1">{account.disabled ? "恢复" : "停用…"}</span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="glass-sep" />
                          <DropdownMenuItem className="glass-mi is-danger" onClick={() => void remove(account)}>
                            <IconTrash className="size-[18px] shrink-0 opacity-80" />
                            <span className="min-w-0 flex-1">{"删除账号…"}</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                ))}
              </Card>
            </PageSection>
            <PageSection description="链接只能用一次，过期自动失效。还没用的可以在这里作废。" title={`未使用的链接 · ${invites.length}`}>
              {invites.length ? (
                <Card className="mem-card">
                  {invites.map((invite) => (
                    <div className="im-row" key={invite.id}>
                      <div className="im-row-main">
                        <ListRow
                          icon={
                            <span className="mem-ico">
                              <IconLink className="size-5" />
                            </span>
                          }
                          sub={<span className="mem-by">{expiresText(invite.expiresAt)}</span>}
                          title={invite.kind === "reset" ? `重置密码 · ${nameOf(invite.accountId)}` : `邀请${invite.note ? ` · ${invite.note}` : ""}`}
                        />
                      </div>
                      <Button onClick={() => void revoke(invite)} size="sm" variant="ghost">
                        {"作废"}
                      </Button>
                    </div>
                  ))}
                </Card>
              ) : (
                <PageEmpty>{"没有未使用的链接。"}</PageEmpty>
              )}
            </PageSection>
          </>
        )}
      </PageShell>
    </>
  );
}

function InviteDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (invite: { url: string; expiresAt: number }) => void }) {
  const [note, setNote] = useState("");
  const [hours, setHours] = useState(72);
  useEffect(() => {
    if (!open) return;
    setNote("");
    setHours(72);
    create.reset();
  }, [open]);
  const create = useAsyncAction(
    async () => {
      const invite = await createInvite({ note: note.trim() || undefined, hours });
      window.setTimeout(() => onCreated(invite), 400);
    },
    { errorToast: (error) => error.message },
  );
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="im-dialog max-w-lg">
        <DialogHeader>
          <DialogTitle>{"邀请朋友"}</DialogTitle>
          <DialogDescription>{"生成一个一次性链接发给朋友。他打开后自己设账号名和密码，登录后会有一个自己的「助手」机器人。"}</DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (create.state !== "pending") void create.run();
          }}
        >
          <DialogBody className="im-form mt-2">
            <label className="im-field" htmlFor="invite-note">
              <span className="im-field-l">
                {"备注"}
                <span className="im-req">{"可选，只有你看得到"}</span>
              </span>
              <Input id="invite-note" maxLength={32} onChange={(event) => setNote(event.target.value)} placeholder={"例如：小明"} value={note} />
            </label>
            <div className="im-field">
              <span className="im-field-l">{"有效期"}</span>
              <div className="flex flex-wrap gap-2">
                {[
                  [24, "1 天"],
                  [72, "3 天"],
                  [168, "7 天"],
                ].map(([value, label]) => (
                  <Button key={value} onClick={() => setHours(value as number)} size="sm" type="button" variant={hours === value ? "default" : "outline"}>
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          </DialogBody>
          <DialogFooter className="mt-4">
            <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">
              {"取消"}
            </Button>
            <Button feedback="create" state={create.state} type="submit">
              {"生成链接"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LinkDialog({ link, onOpenChange }: { link: { title: string; url: string; expiresAt: number } | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog onOpenChange={onOpenChange} open={Boolean(link)}>
      <DialogContent className="im-dialog max-w-lg">
        <DialogHeader>
          <DialogTitle>{link?.title ?? ""}</DialogTitle>
          <DialogDescription>{`复制下面的链接发给他（微信、QQ 都行）。只能用一次，${link ? expiresText(link.expiresAt) : ""}。关掉这个窗口后就看不到完整链接了。`}</DialogDescription>
        </DialogHeader>
        <DialogBody className="im-form mt-2">
          <Input aria-label={"链接"} className="font-mono" onFocus={(event) => event.currentTarget.select()} readOnly value={link?.url ?? ""} />
        </DialogBody>
        <DialogFooter className="mt-4">
          <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">
            {"完成"}
          </Button>
          <CopyButton value={link?.url ?? ""}>{"复制链接"}</CopyButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
