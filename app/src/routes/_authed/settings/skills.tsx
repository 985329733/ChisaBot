import { IconDots, IconPencil, IconPlus, IconSparkles, IconTrash, IconUsers } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageEmpty, PageSection, PageShell, PageSkeleton } from "@/components/layout/page-shell";
import { SearchBox } from "@/components/memory/memory-notes";
import { useAsyncAction } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Card, ErrorCard, ListRow, Toolbar } from "@/components/ui/skyglass";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { type ChisaSkill, chisaSkillKeys, chisaSkillsQueryOptions, deleteChisaSkill, saveChisaSkill } from "@/lib/chisa-skills";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/settings/skills")({
  component: SkillsPage,
});

const SLUG = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

/**
 * 设置 → 技能（DESIGN.md §51）：你存下来的「某类事怎么做」。所有机器人按需加载；聊天框里输入 /名字 也能直接用。
 */
function SkillsPage() {
  const queryClient = useQueryClient();
  const list = useQuery(chisaSkillsQueryOptions());
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; skill: ChisaSkill | null }>({ open: false, skill: null });
  const q = query.trim().toLocaleLowerCase();
  const skills = (list.data ?? []).filter(
    (skill) => skill.slug !== hidden && (!q || [skill.slug, skill.title, skill.summary, skill.instructions].some((part) => part.toLocaleLowerCase().includes(q))),
  );
  const mine = skills.filter((skill) => skill.mine);
  const shared = skills.filter((skill) => !skill.mine);
  const refresh = () => queryClient.invalidateQueries({ queryKey: chisaSkillKeys.all });
  async function remove(skill: ChisaSkill) {
    const ok = await confirmDialog({ title: `删除技能「${skill.title}」？`, description: "机器人以后不会再按它做事。删除后 8 秒内可以撤销。", confirmLabel: "删除", destructive: true });
    if (!ok) return;
    setHidden(skill.slug);
    try {
      await deleteChisaSkill(skill.slug);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
      return;
    } finally {
      setHidden(null);
    }
    toast.undo(`已删除技能「${skill.title}」`, async () => {
      try {
        await saveChisaSkill(skill.slug, { title: skill.title, summary: skill.summary, instructions: skill.instructions, create: true });
        await refresh();
      } catch {
        toast.error("恢复失败");
      }
    });
  }
  const row = (skill: ChisaSkill) => (
    <div className="im-row" key={skill.slug}>
      <button className="im-row-main" onClick={() => setDialog({ open: true, skill })} type="button">
        <ListRow
          icon={
            <span className={cn("mem-ico", !skill.mine && "is-note")}>
              {skill.mine ? <IconSparkles className="size-5" /> : <IconUsers className="size-5" />}
            </span>
          }
          sub={
            <>
              {skill.summary ? <span className="mem-body">{skill.summary}</span> : null}
              <span className="device-row-meta">
                <span className="skill-slug">{`/${skill.slug}`}</span>
                {skill.mine ? null : <span className="device-cap-chip">{"共享 · 只读"}</span>}
              </span>
            </>
          }
          title={skill.title}
        />
      </button>
      {skill.mine ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<button aria-label={`「${skill.title}」的更多操作`} className="device-row-more" title={"更多操作"} type="button" />}>
            <IconDots className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="glass-pop w-[180px] p-1.5">
            <DropdownMenuItem className="glass-mi" onClick={() => setDialog({ open: true, skill })}>
              <IconPencil className="size-[18px] shrink-0 opacity-80" />
              <span className="min-w-0 flex-1">{"编辑…"}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="glass-sep" />
            <DropdownMenuItem className="glass-mi is-danger" onClick={() => void remove(skill)}>
              <IconTrash className="size-[18px] shrink-0 opacity-80" />
              <span className="min-w-0 flex-1">{"删除…"}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
  return (
    <>
      <SkillDialog onOpenChange={(open) => setDialog((current) => ({ ...current, open }))} open={dialog.open} skill={dialog.skill} />
      <PageShell
        action={
          <Button onClick={() => setDialog({ open: true, skill: null })} size="sm">
            <IconPlus />
            {"新建技能"}
          </Button>
        }
        description="技能是你存下来的「某类事怎么做」：步骤、偏好、要用的网站、踩过的坑。你的所有机器人做事前会按需加载对得上的技能；聊天框里输入 / 加名字也能直接用。机器人摸索出一套好做法时，会问你要不要存成技能。"
        title="技能"
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
            title="技能暂时无法读取"
          />
        ) : (
          <>
            {(list.data ?? []).length > 4 ? (
              <Toolbar className="mem-toolbar">
                <span />
                <SearchBox onChange={setQuery} placeholder={"搜索技能"} value={query} />
              </Toolbar>
            ) : null}
            <PageSection title={`我的技能 · ${mine.length}`}>
              {mine.length ? (
                <Card className="mem-card">{mine.map(row)}</Card>
              ) : (
                <PageEmpty>{q ? "没有符合条件的技能。" : "还没有技能。点右上角「新建技能」，或者让机器人把一次做得好的流程存下来。"}</PageEmpty>
              )}
            </PageSection>
            {shared.length ? (
              <PageSection description="管理员给所有人准备的技能，只读。" title={`共享技能 · ${shared.length}`}>
                <Card className="mem-card">{shared.map(row)}</Card>
              </PageSection>
            ) : null}
          </>
        )}
      </PageShell>
    </>
  );
}

function SkillDialog({ open, skill, onOpenChange }: { open: boolean; skill: ChisaSkill | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const readOnly = Boolean(skill && !skill.mine);
  const [form, setForm] = useState({ slug: "", title: "", summary: "", instructions: "" });
  useEffect(() => {
    if (!open) return;
    setForm(skill ? { slug: skill.slug, title: skill.title, summary: skill.summary, instructions: skill.instructions } : { slug: "", title: "", summary: "", instructions: "" });
    save.reset();
  }, [open, skill]);
  const save = useAsyncAction(
    async () => {
      await saveChisaSkill(form.slug, { title: form.title, summary: form.summary, instructions: form.instructions, create: !skill });
      await queryClient.invalidateQueries({ queryKey: chisaSkillKeys.all });
      window.setTimeout(() => onOpenChange(false), 600);
    },
    { errorToast: (error) => error.message },
  );
  const slugOk = SLUG.test(form.slug);
  const valid = slugOk && form.title.trim() && form.instructions.trim();
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="im-dialog max-w-2xl">
        <DialogHeader>
          <DialogTitle>{readOnly ? skill!.title : skill ? "编辑技能" : "新建技能"}</DialogTitle>
          <DialogDescription>{readOnly ? "共享技能，只读。" : "写成以后照着就能做的方法：步骤、偏好、注意事项。不要写密码。"}</DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !readOnly && save.state !== "pending") void save.run();
          }}
        >
          <DialogBody className="im-form mt-2">
            <div className="im-grid">
              <label className="im-field" htmlFor="skill-title">
                <span className="im-field-l">
                  {"标题"}
                  <span className="im-req">{"必填"}</span>
                </span>
                <Input disabled={readOnly} id="skill-title" maxLength={60} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder={"如「写周报」"} value={form.title} />
              </label>
              <label className="im-field" htmlFor="skill-slug">
                <span className="im-field-l">
                  {"名字"}
                  <span className="im-req">{skill ? "不能改" : "小写字母、数字、连字符"}</span>
                </span>
                <Input
                  className="font-mono"
                  disabled={Boolean(skill)}
                  id="skill-slug"
                  maxLength={40}
                  onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
                  placeholder={"weekly-report"}
                  value={form.slug}
                />
                {!skill && form.slug && !slugOk ? <span className="im-field-h">{"2–40 个字符，首尾不能是连字符。"}</span> : null}
              </label>
            </div>
            <label className="im-field" htmlFor="skill-summary">
              <span className="im-field-l">
                {"什么时候用"}
                <span className="im-req">{"一句话，机器人靠它判断要不要加载"}</span>
              </span>
              <Input disabled={readOnly} id="skill-summary" maxLength={200} onChange={(event) => setForm({ ...form, summary: event.target.value })} placeholder={"用户让我写本周工作周报时"} value={form.summary} />
            </label>
            <label className="im-field" htmlFor="skill-instructions">
              <span className="im-field-l">
                {"方法说明"}
                <span className="im-req">{"必填，支持 Markdown"}</span>
              </span>
              <Textarea
                className="skill-instructions"
                disabled={readOnly}
                id="skill-instructions"
                maxLength={20000}
                onChange={(event) => setForm({ ...form, instructions: event.target.value })}
                rows={12}
                value={form.instructions}
              />
            </label>
          </DialogBody>
          <DialogFooter className="mt-4">
            <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">
              {readOnly ? "关闭" : "取消"}
            </Button>
            {readOnly ? null : (
              <Button disabled={!valid} feedback="save" state={save.state} type="submit">
                {"保存"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
