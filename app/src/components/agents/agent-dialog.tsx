import {
  IconAdjustments,
  IconArrowsExchange,
  IconClock,
  IconPencil,
  IconPlugConnected,
  IconPuzzle,
  IconUser,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { ZodType } from "zod";
import { AbstractAvatar } from "@/components/agents/abstract-avatar";
import { DeleteBotDialog } from "@/components/agents/delete-bot-dialog";
import { CallbackTokenPanel } from "@/components/agents/callback-token-panel";
import { HandoffPanel } from "@/components/agents/handoff-panel";
import { BotModelSelector } from "@/components/agents/bot-model-selector";
import { RoutinesList } from "@/components/routines/routines-list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  type AgentFormValues,
  agentFormSchema,
  agentInputFrom,
} from "@/lib/agents/form";
import {
  duplicateAgentMutationOptions,
  setAgentHiddenMutationOptions,
  setAgentPinnedMutationOptions,
  updateAgentMutationOptions,
} from "@/lib/agents/mutations";
import { type AgentProfile, agentQueryOptions } from "@/lib/agents/queries";
import { isComposing } from "@/lib/composing";
import { agentPluginsQueryOptions } from "@/lib/plugins/queries";
import { readToolName } from "@/lib/plugins/tool-name";

/**
 * A coworker, in a dialog with its own sidebar.
 *
 * The agents screen used to slide this in as a side panel; a profile carries enough distinct
 * concerns — who it is, where it runs, what it may hand work to, and what can be done to it — that
 * a single scrolling column buried the later ones. Each concern is a section here, and the sidebar
 * is the map.
 */
export function AgentDialog({
  agentId,
  open,
  onClose,
}: {
  /** Which coworker to show. Null renders nothing but keeps the dialog mounted for its exit. */
  agentId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog onOpenChange={(next) => !next && onClose()} open={open}>
      {/* p-0/overflow-hidden hands the popup's rounding to the sidebar; wider than the default
          dialog because it holds a two-pane layout, which is the stated reason to deviate. */}
      {/* Tall enough that General's rows and its Delete sit on screen together; the popup's own
          max-h-[85svh] still caps it on a short display, where the main pane scrolls. */}
      <DialogContent className="overflow-hidden p-0 md:max-h-[680px] md:max-w-[700px] lg:max-w-[800px]">
        {/* Keyed by coworker so the section and edit state never carry over from another one. */}
        {agentId ? <AgentDialogBody agentId={agentId} key={agentId} /> : null}
      </DialogContent>
    </Dialog>
  );
}

const SECTIONS = [
  { id: "general", name: "通用", icon: IconUser },
  { id: "access", name: "Access", icon: IconPuzzle },
  { id: "connection", name: "连接", icon: IconPlugConnected },
  { id: "handoff", name: "交接", icon: IconArrowsExchange },
  { id: "routines", name: "例行任务", icon: IconClock },
  { id: "manage", name: "Manage", icon: IconAdjustments },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function AgentDialogBody({ agentId }: { agentId: string }) {
  const [section, setSection] = useState<SectionId>("general");
  const agent = useQuery(agentQueryOptions(agentId));

  if (agent.isPending) {
    return (
      <div className="flex h-[640px] max-h-[80svh] flex-col gap-4 p-6">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  if (agent.error || !agent.data) {
    return (
      <p className="p-6 text-sm text-destructive" role="alert">
        {"无法加载此AI同事。"}
      </p>
    );
  }
  const profile = agent.data;
  const active = SECTIONS.find((candidate) => candidate.id === section);

  return (
    <>
      <DialogTitle className="sr-only">{profile.name}</DialogTitle>
      {/* min-h-full overrides the provider's own min-h-svh, which is sized for a page. */}
      <SidebarProvider className="min-h-full items-start">
        <Sidebar className="hidden md:flex" collapsible="none">
          {/* Who this dialog is about, said once here rather than repeated per section. */}
          <SidebarHeader className="flex-row items-center gap-3 p-4">
            <AbstractAvatar
              name={profile.name}
              seed={profile.avatarSeed}
              size={36}
            />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">
                {profile.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {profile.title}
              </span>
            </div>
          </SidebarHeader>
          <SidebarContent className="mt-2">
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu className="gap-px">
                  {SECTIONS.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        isActive={item.id === section}
                        onClick={() => setSection(item.id)}
                      >
                        <item.icon />
                        <span>{item.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <main className="flex h-[640px] max-h-[80svh] flex-1 flex-col overflow-hidden">
          {/*
           * The sidebar hides below md, and without this strip that left the sections unreachable
           * on a phone: the dialog opened on General and nothing could leave it. A scrollable row
           * of the same sections, shown only where the sidebar is not. The identity the sidebar
           * header carries rides along, with room kept for the popup's close button.
           */}
          <div className="flex shrink-0 flex-col gap-2 border-b border-border p-3 pr-12 md:hidden">
            <div className="flex items-center gap-2">
              <AbstractAvatar
                name={profile.name}
                seed={profile.avatarSeed}
                size={28}
              />
              <span className="truncate text-sm font-medium">
                {profile.name}
              </span>
            </div>
            <div className="flex gap-1 overflow-x-auto">
              {SECTIONS.map((item) => (
                <Button
                  className="shrink-0"
                  key={item.id}
                  onClick={() => setSection(item.id)}
                  size="sm"
                  variant={item.id === section ? "secondary" : "ghost"}
                >
                  <item.icon />
                  {item.name}
                </Button>
              ))}
            </div>
          </div>
          <header className="flex h-14 shrink-0 items-center gap-2 px-6">
            <h2 className="text-sm font-medium">{active?.name}</h2>
          </header>
          <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6">
            {section === "general" ? (
              <GeneralSection agentId={agentId} profile={profile} />
            ) : section === "access" ? (
              <AccessSection agentId={agentId} />
            ) : section === "connection" ? (
              <ConnectionSection agentId={agentId} profile={profile} />
            ) : section === "handoff" ? (
              <HandoffPanel agentId={agentId} />
            ) : section === "routines" ? (
              <RoutinesList agentId={agentId} embedded />
            ) : (
              <ManageSection agentId={agentId} profile={profile} />
            )}
          </div>
        </main>
      </SidebarProvider>
    </>
  );
}

function GeneralSection({
  agentId,
  profile,
}: {
  agentId: string;
  profile: AgentProfile;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const updateAgent = useMutation(updateAgentMutationOptions(queryClient));

  /*
   * One field at a time, over the whole update endpoint: the API takes the full profile, so the
   * unchanged fields ride along as they are on screen. The empty key means "keep the current one".
   */
  const save = (patch: Partial<AgentFormValues>) =>
    updateAgent.mutateAsync({
      agentId,
      input: agentInputFrom({
        name: profile.name,
        title: profile.title,
        roleDescription: profile.roleDescription,
        visibility: profile.visibility,
        /*
         * Not a built-in coworker's endpoint. That is the managed Bot's own address, which nobody
         * typed, and the route checks any endpoint it is sent as one somebody did: on a deployment
         * whose Bot is on localhost it refused every edit. Empty leaves the stored one where it is.
         */
        endpoint: profile.builtIn ? "" : (profile.endpoint ?? ""),
        authValue: "",
        ...patch,
      }),
    });

  return (
    <>
      {/* Each stands on its own — muted, not bg-card, which is invisible against a popup — and
          each edits in place: the field somebody wants to change is the only one that opens. */}
      <div className="flex flex-col gap-2">
        <EditableTextItem
          canManage={profile.canManage}
          label={"名称"}
          onSave={(name) => save({ name })}
          schema={agentFormSchema.shape.name}
          value={profile.name}
        />
        <EditableTextItem
          canManage={profile.canManage}
          label={"标题"}
          onSave={(title) => save({ title })}
          schema={agentFormSchema.shape.title}
          value={profile.title}
        />
        <EditableTextItem
          canManage={profile.canManage}
          label={"角色"}
          multiline
          onSave={(roleDescription) => save({ roleDescription })}
          schema={agentFormSchema.shape.roleDescription}
          value={profile.roleDescription}
        />
        <VisibilityItem
          canManage={profile.canManage}
          onSave={(visibility) => save({ visibility })}
          value={profile.visibility}
        />
        <Item variant="muted"><ItemContent><ItemTitle>模型设置</ItemTitle><BotModelSelector agentId={agentId} /></ItemContent></Item>
        {profile.systemOwned ? (
          <Item variant="muted">
            <ItemContent>
              <ItemTitle>{"系统拥有"}</ItemTitle>
              <ItemDescription>
                {"此部署随附，而不是属于某人。"}
              </ItemDescription>
            </ItemContent>
          </Item>
        ) : null}
      </div>

      <Item variant="muted">
        <ItemContent>
          <ItemTitle>{"开始会话"}</ItemTitle>
          <ItemDescription>{"与此 AI 同事开启新会话。"}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            onClick={() =>
              void navigate({
                search: { agent: agentId },
                to: "/channel/new",
              })
            }
            size="sm"
          >
            {"开始"}
          </Button>
        </ItemActions>
      </Item>
    </>
  );
}

/**
 * One fact about the coworker, edited in place.
 *
 * Only the field somebody wants to change opens: Edit swaps this item — and this item alone — for
 * its input, validated against the same limits the server enforces, and Save writes just it back.
 */
function EditableTextItem({
  label,
  value,
  canManage,
  multiline = false,
  schema,
  onSave,
}: {
  label: string;
  value: string;
  canManage: boolean;
  /** A textarea rather than an input, for the field that is a paragraph. */
  multiline?: boolean;
  /** The field's slice of the shared form contract, so errors match the server's limits. */
  schema: ZodType<string>;
  onSave: (draft: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setEditing(false);
    setError(null);
  };
  const submit = async () => {
    const parsed = schema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "该值不合适。");
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed.data);
      close();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "无法保存。");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <Item variant="muted">
        <ItemContent>
          <ItemTitle>{label}</ItemTitle>
        </ItemContent>
        <ItemActions className="min-w-0">
          <span
            className={`text-right text-sm text-muted-foreground ${
              multiline ? "line-clamp-2 whitespace-pre-wrap" : "truncate"
            }`}
          >
            {value}
          </span>
          {canManage ? (
            <Button
              aria-label={`编辑 ${label.toLowerCase()}`}
              onClick={() => {
                setDraft(value);
                setEditing(true);
              }}
              size="icon-sm"
              variant="ghost"
            >
              <IconPencil />
            </Button>
          ) : null}
        </ItemActions>
      </Item>
    );
  }

  return (
    <Item variant="muted">
      <ItemContent>
        <ItemTitle>{label}</ItemTitle>
        {multiline ? (
          <Textarea
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            value={draft}
          />
        ) : (
          <Input
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Not the Enter that confirms a composed character: that one would save the value
              // before the person has finished typing it.
              if (event.key === "Enter" && !isComposing(event)) {
                event.preventDefault();
                void submit();
              }
            }}
            value={draft}
          />
        )}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-1 flex gap-2">
          <Button disabled={saving} onClick={() => void submit()} size="sm">
            {saving ? "正在保存…" : "保存"}
          </Button>
          <Button disabled={saving} onClick={close} size="sm" variant="outline">
            {"取消"}
          </Button>
        </div>
      </ItemContent>
    </Item>
  );
}

/**
 * Visibility is two named choices, so it edits as a select that writes on pick — no open state and
 * no Save, because there is no draft worth holding: the pick is the whole of the change.
 */
function VisibilityItem({
  value,
  canManage,
  onSave,
}: {
  value: AgentProfile["visibility"];
  canManage: boolean;
  onSave: (visibility: AgentProfile["visibility"]) => Promise<unknown>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Item variant="muted">
      <ItemContent>
        <ItemTitle>{"可见性"}</ItemTitle>
        <ItemDescription>
          {value === "private"
            ? "只有你能看到它并与之启动会话。"
            : "部署中的每个人都可以找到并使用它。"}
        </ItemDescription>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </ItemContent>
      <ItemActions>
        {canManage ? (
          <Select
            disabled={saving}
            // The label map, so the closed trigger says "Private" rather than the raw value.
            items={{ private: "私有", public: "Public" }}
            onValueChange={async (next) => {
              if (next === value) return;
              setError(null);
              setSaving(true);
              try {
                await onSave(next as AgentProfile["visibility"]);
              } catch (failure) {
                setError(
                  failure instanceof Error ? failure.message : "无法保存。",
                );
              } finally {
                setSaving(false);
              }
            }}
            value={value}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="private">{"私有"}</SelectItem>
              <SelectItem value="public">{"公开"}</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <span className="text-sm text-muted-foreground">
            {value === "private" ? "私有" : "公开"}
          </span>
        )}
      </ItemActions>
    </Item>
  );
}

/** "google-drive" as "Google Drive": the connector key, said the way a person would. */
function connectorName(key: string): string {
  return key
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * What this coworker may reach when it works: its granted connectors, one row each, and its skills.
 *
 * Read from the same snapshot the runtime offers the Bot, so this shows what a run would actually
 * hold rather than a second opinion. Read-only on purpose — granting is an administrator's, made on
 * the Plugins screens, and a row of switches here would be a second place for the same decision.
 */
function AccessSection({ agentId }: { agentId: string }) {
  const plugins = useQuery(agentPluginsQueryOptions(agentId));

  if (plugins.isPending) return null;
  if (plugins.error || !plugins.data) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {"此AI同事可以访问的内容无法加载。"}
      </p>
    );
  }

  /* One row per connector, carrying what a person recognises: the tools' names, not their count. */
  const connectors = new Map<string, string[]>();
  for (const tool of plugins.data.tools) {
    const key = tool.ref.split("/")[0] ?? tool.ref;
    let label = readToolName(tool.toolName).label;
    /*
     * Vendors prefix every tool with their own name — "Notion create pages" — which next to a row
     * already titled Notion reads as a stutter. Stripped only as a leading word, and re-cased, so
     * "Notion search" becomes "Search" while "Search notion pages" is left alone.
     */
    const prefix = `${key.toLowerCase()} `;
    if (label.toLowerCase().startsWith(prefix)) {
      const rest = label.slice(prefix.length);
      label = rest ? rest[0]?.toUpperCase() + rest.slice(1) : label;
    }
    const labels = connectors.get(key) ?? [];
    labels.push(label);
    connectors.set(key, labels);
  }
  const skills = plugins.data.skills;

  if (connectors.size === 0 && skills.length === 0) {
    return (
      <Empty className="h-[180px] border border-dashed">
        <EmptyHeader>
          <EmptyTitle className="text-muted-foreground">
            {"尚未授权"}
          </EmptyTitle>
          <EmptyDescription>
            {
              "管理员从插件屏幕授予连接器和技能。在此之前，此 AI 同事可以对话，仅此而已。"
            }
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {
          "此AI同事在工作时可以访问的内容。由管理员在插件页面授予；未列出的任何内容在调用时被拒绝。"
        }
      </p>
      <div className="flex flex-col gap-2">
        {[...connectors.entries()].map(([key, labels]) => (
          <Item key={key} variant="muted">
            <ItemContent>
              <ItemTitle>{connectorName(key)}</ItemTitle>
              <ItemDescription>
                {labels.slice(0, 4).join(", ")}
                {labels.length > 4 ? `以及 ${labels.length - 4} 更多` : ""}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <span className="text-sm text-muted-foreground tabular-nums">
                {labels.length} {labels.length === 1 ? "工具" : "工具"}
              </span>
            </ItemActions>
          </Item>
        ))}
        {skills.map((skill) => (
          <Item key={skill.slug} variant="muted">
            <ItemContent>
              <ItemTitle>{skill.title}</ItemTitle>
              <ItemDescription>{skill.summary}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <span className="text-sm text-muted-foreground">{"技能"}</span>
            </ItemActions>
          </Item>
        ))}
      </div>
    </>
  );
}

function ConnectionSection({
  agentId,
  profile,
}: {
  agentId: string;
  profile: AgentProfile;
}) {
  /*
   * A built-in coworker is done the moment it exists: it runs on the deployment's own Bot, whose
   * process already holds the deployment's tool credential, so its tool calls authenticate with no
   * setup. Showing it the endpoint and the callback-token panel told the person the opposite —
   * an internal address they never typed, and a credential they were never supposed to need.
   */
  if (!profile.endpoint || profile.builtIn) {
    return (
      <p className="text-sm text-muted-foreground">
        {
          "在此部署的自身机器人上运行。无需连接和认证：其工具调用由部署自身的凭证覆盖。"
        }
      </p>
    );
  }
  return (
    <>
      <section className="grid gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {"端点"}
        </h2>
        <p className="break-all font-mono text-sm">{profile.endpoint}</p>
      </section>
      {profile.canManage ? (
        <CallbackTokenPanel
          agentId={agentId}
          hasToken={profile.hasCallbackToken}
        />
      ) : null}
    </>
  );
}

function ManageSection({
  agentId,
  profile,
}: {
  agentId: string;
  profile: AgentProfile;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const setPinned = useMutation(setAgentPinnedMutationOptions(queryClient));
  const setHidden = useMutation(setAgentHiddenMutationOptions(queryClient));
  const duplicateAgent = useMutation(
    duplicateAgentMutationOptions(queryClient),
  );
  const actionError =
    setPinned.error ?? setHidden.error ?? duplicateAgent.error;

  return (
    <>
      {/* The same gap the General items keep, so the two screens read as one list style. */}
      <div className="flex flex-col gap-2">
        <Item variant="muted">
          <ItemContent>
            <ItemTitle>{profile.pinned ? "已固定" : "固定"}</ItemTitle>
            <ItemDescription>
              {profile.pinned
                ? "在你的代理列表顶部。这对其他人没有任何影响。"
                : "将其保持在您的代理列表顶部。这对其他人没有任何改变。"}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button
              disabled={setPinned.isPending}
              onClick={() =>
                setPinned.mutate({ agentId, pinned: !profile.pinned })
              }
              size="sm"
              variant="outline"
            >
              {setPinned.isPending
                ? profile.pinned
                  ? "取消固定中…"
                  : "正在固定…"
                : profile.pinned
                  ? "取消固定"
                  : "固定"}
            </Button>
          </ItemActions>
        </Item>

        <Item variant="muted">
          <ItemContent>
            <ItemTitle>{profile.hidden ? "隐藏" : "隐藏"}</ItemTitle>
            <ItemDescription>
              {profile.hidden
                ? "从你的代理列表隐藏。这对其他人无影响"
                : "将其从您的代理列表中移除。这对其他人没有任何影响。"}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button
              disabled={setHidden.isPending}
              onClick={async () => {
                await setHidden.mutateAsync({
                  agentId,
                  hidden: !profile.hidden,
                });
                if (!profile.hidden)
                  await navigate({ search: {}, to: "/agents" });
              }}
              size="sm"
              variant="outline"
            >
              {setHidden.isPending
                ? profile.hidden
                  ? "取消隐藏中…"
                  : "正在隐藏…"
                : profile.hidden
                  ? "取消隐藏"
                  : "隐藏"}
            </Button>
          </ItemActions>
        </Item>

        <Item variant="muted">
          <ItemContent>
            <ItemTitle>{"复制"}</ItemTitle>
            <ItemDescription>
              {"你自己的副本，没有密钥也没有通道。"}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button loading={duplicateAgent.isPending}
              disabled={duplicateAgent.isPending}
              onClick={async () => {
                const copy = await duplicateAgent.mutateAsync(agentId);
                await navigate({ search: { agent: copy.id }, to: "/agents" });
              }}
              size="sm"
              variant="outline"
            >
              {duplicateAgent.isPending ? "正在复制…" : "复制"}
            </Button>
          </ItemActions>
        </Item>

        {profile.canManage ? (
          <Item variant="muted">
            <ItemContent>
              <ItemTitle>{"删除机器人"}</ItemTitle>
              <ItemDescription>
                {"彻底删除它，以及你与它的私人会话、记忆、定时任务和面板。此操作无法撤消。"}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                onClick={() => setConfirmingDelete(true)}
                size="sm"
                variant="destructive"
              >
                {"删除"}
              </Button>
            </ItemActions>
          </Item>
        ) : null}
      </div>

      {actionError ? (
        <p className="text-sm text-destructive" role="alert">
          {actionError.message}
        </p>
      ) : null}

      {/* Stacked over the agent dialog: destroying something deserves its own moment, and the
          question keeps the name in it so the wrong tab cannot delete the wrong coworker. */}
      <DeleteBotDialog
        bot={{ id: agentId, name: profile.name }}
        onOpenChange={setConfirmingDelete}
        open={confirmingDelete}
      />
    </>
  );
}
