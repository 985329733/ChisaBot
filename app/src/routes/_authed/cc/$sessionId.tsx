import {
  IconArrowBackUp,
  IconArrowUp,
  IconChevronLeft,
  IconDots,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconPencil,
  IconArchive,
  IconPlayerStopFilled,
  IconRefreshDot,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CC_EFFORT_ZH, CC_EFFORTS, CC_MODELS, type CcMessage } from "../../../../../shared/cloud-cc";
import { CcRightContent, type RightTab } from "@/components/cloud-cc/cc-right-panel";
import { CcMessageView } from "@/components/cloud-cc/cc-transcript";
import { SyncPill } from "@/components/cloud-cc/cc-tree";
import { PageSkeleton } from "@/components/layout/page-shell";
import { useAsyncAction } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useOptionalSidebar } from "@/components/ui/sidebar";
import { ErrorCard } from "@/components/ui/skyglass";
import { toast } from "@/components/ui/toast";
import { ccApi, ccKeys, ccSessionQueryOptions, ccWorkspacesQueryOptions, LAST_CC_SESSION_KEY, rememberLeftMode, type SessionDetail, useCcSessionStream } from "@/lib/cloud-cc";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/cc/$sessionId")({
  component: CcSessionPage,
});

const RIGHT_KEY = "chisabot-cc-right";

/**
 * 一个 Claude Code 会话（DESIGN.md §73.3–§73.6）：对话头（标题 · 工作区 · 接着上次 · 同步状态 · ⋯）、消息流、输入框；
 * 右栏「改动｜文件」桌面上可以收起，手机上是底部抽屉（半屏，上拉全屏，下拉收起）。
 */
function CcSessionPage() {
  const { sessionId } = Route.useParams();
  const detail = useQuery(ccSessionQueryOptions(sessionId));
  useEffect(() => {
    rememberLeftMode("cc");
    try {
      localStorage.setItem(LAST_CC_SESSION_KEY, sessionId);
    } catch {}
  }, [sessionId]);
  if (detail.isPending) return <PageSkeleton rows={4} />;
  if (detail.isError)
    return (
      <div className="cc-center">
        <ErrorCard
          action={
            <Button render={<Link to="/cc" />} variant="outline">
              {"回到 Claude Code"}
            </Button>
          }
          description={detail.error.message}
          title="打不开这个会话"
        />
      </div>
    );
  return <CcSession detail={detail.data} key={sessionId} sessionId={sessionId} />;
}

function CcSession({ sessionId, detail }: { sessionId: string; detail: SessionDetail }) {
  const queryClient = useQueryClient();
  const sidebar = useOptionalSidebar();
  const phone = !!sidebar?.isMobile;
  const navigate = useNavigate();
  const stream = useCcSessionStream(sessionId, detail);
  const workspaces = useQuery(ccWorkspacesQueryOptions());
  const ws = workspaces.data?.find((w) => w.id === detail.session.workspaceId);
  const session = workspaces.data?.flatMap((w) => w.sessions).find((s) => s.id === sessionId) ?? detail.session;
  const running = stream.status === "running" || stream.status === "waiting";
  const [rightOpen, setRightOpen] = useState(() => {
    try {
      return localStorage.getItem(RIGHT_KEY) !== "closed";
    } catch {
      return true;
    }
  });
  const [drawer, setDrawer] = useState<"closed" | "half" | "full">("closed");
  const [tab, setTab] = useState<RightTab>("changes");
  const [turnId, setTurnId] = useState<string | null>(null);

  // 一轮结束：刷新右栏和左栏。
  const lastDone = stream.messages.filter((m) => m.role === "assistant" && m.status !== "running").length;
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["claude-code", "diff", sessionId] });
    void queryClient.invalidateQueries({ queryKey: ["claude-code", "files", sessionId] });
    void queryClient.invalidateQueries({ queryKey: ["claude-code", "file", sessionId] });
    void queryClient.invalidateQueries({ queryKey: ccKeys.workspaces });
  }, [lastDone, sessionId, queryClient]);

  const toggleRight = () => {
    if (phone) {
      setDrawer((d) => (d === "closed" ? "half" : "closed"));
      return;
    }
    setRightOpen((o) => {
      try {
        localStorage.setItem(RIGHT_KEY, o ? "closed" : "open");
      } catch {}
      return !o;
    });
  };
  const openDiff = useCallback(
    (id: string) => {
      setTurnId(id);
      setTab("changes");
      if (phone) setDrawer("half");
      else
        setRightOpen(() => {
          try {
            localStorage.setItem(RIGHT_KEY, "open");
          } catch {}
          return true;
        });
    },
    [phone],
  );

  const stop = useAsyncAction(() => ccApi.stop(sessionId), { errorToast: (e) => `停止失败：${e.message}` });
  const menu = async (action: "new" | "undo" | "rename" | "archive") => {
    try {
      if (action === "new") {
        await ccApi.newClaudeSession(sessionId);
      } else if (action === "undo") {
        const ok = await confirmDialog({ title: "撤销最后一轮的改动？", description: "把会话目录恢复到最后一轮开始之前。对话记录保留。", confirmLabel: "撤销" });
        if (!ok) return;
        await ccApi.undoTurn(sessionId);
        setTurnId(null);
      } else if (action === "rename") {
        const title = window.prompt("会话名称", session.title);
        if (!title?.trim()) return;
        await ccApi.patchSession(sessionId, { title: title.trim() });
      } else {
        const ok = await confirmDialog({ title: "归档这个会话？", description: "从左栏移走，目录和记录都保留。", confirmLabel: "归档" });
        if (!ok) return;
        await ccApi.patchSession(sessionId, { archived: true });
        await queryClient.invalidateQueries({ queryKey: ccKeys.workspaces });
        try {
          localStorage.removeItem(LAST_CC_SESSION_KEY);
        } catch {}
        void navigate({ to: "/cc" });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ccKeys.workspaces });
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const header = (
    <header className="cc-head" data-testid="cc-head">
      {phone ? (
        <Link aria-label="返回工作区列表" className="cc-back" to="/cc">
          <IconChevronLeft className="size-5" />
        </Link>
      ) : null}
      <div className="cc-head-main">
        <h1 className="cc-title" data-testid="cc-title">
          {session.title}
        </h1>
        <div className="cc-head-pills">
          <span className="cc-pill is-info">{`${ws?.name ?? "工作区"} · ${session.branch ?? "自己的目录"}`}</span>
          {!phone ? <span className="cc-pill" data-testid="cc-resume-pill">{session.resumable ? `接着上次 · ${session.turns} 轮` : "新的 Claude 会话"}</span> : null}
          {ws && !phone ? <SyncPill state={ws.syncState} /> : null}
        </div>
      </div>
      <div className="cc-head-actions">
        <DropdownMenu>
          <DropdownMenuTrigger render={<button aria-label="更多" className="cc-icon-btn is-lg" data-testid="cc-menu" type="button" />}>
            <IconDots className="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem data-testid="cc-menu-new" disabled={running} onClick={() => void menu("new")}>
              <IconRefreshDot className="size-4" />
              {"新的 Claude 会话（清掉上下文）"}
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="cc-menu-undo" disabled={running} onClick={() => void menu("undo")}>
              <IconArrowBackUp className="size-4" />
              {"撤销最后一轮的改动"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void menu("rename")}>
              <IconPencil className="size-4" />
              {"重命名"}
            </DropdownMenuItem>
            {running ? (
              <DropdownMenuItem onClick={() => void stop.run()}>
                <IconPlayerStopFilled className="size-4" />
                {"停止"}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={running} onClick={() => void menu("archive")}>
              <IconArchive className="size-4" />
              {"归档"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button aria-expanded={phone ? drawer !== "closed" : rightOpen} aria-label={phone ? "文件和改动" : rightOpen ? "收起右栏" : "展开右栏"} className="cc-icon-btn is-lg" data-testid="cc-toggle-right" onClick={toggleRight} type="button">
          {(phone ? drawer !== "closed" : rightOpen) ? <IconLayoutSidebarRightCollapse className="size-5" /> : <IconLayoutSidebarRightExpand className="size-5" />}
        </button>
      </div>
    </header>
  );

  return (
    <div className={cn("cc-session", !phone && rightOpen && "is-right-open", phone && "is-phone")} data-testid="cc-session">
      <div className="cc-chat">
        {header}
        <Transcript messages={stream.messages} onOpenDiff={openDiff} statusText={stream.statusText} />
        <Composer onStop={() => void stop.run()} phone={phone} running={running} session={session} sessionId={sessionId} stopState={stop.state} />
      </div>
      {phone ? (
        <Drawer state={drawer} onState={setDrawer}>
          <CcRightContent enabled={drawer !== "closed"} onTab={setTab} sessionId={sessionId} tab={tab} turnId={turnId} />
        </Drawer>
      ) : (
        <aside aria-hidden={!rightOpen} className="cc-right glass-card" data-testid="cc-right" inert={!rightOpen}>
          <CcRightContent enabled={rightOpen} onTab={setTab} sessionId={sessionId} tab={tab} turnId={turnId} />
        </aside>
      )}
    </div>
  );
}

/** 消息流：贴着底部；你往上翻了就不再自动往下拉（§35 的原则，不跳版）。 */
function Transcript({ messages, statusText, onOpenDiff }: { messages: CcMessage[]; statusText: string | null; onOpenDiff: (turnId: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  return (
    <div
      className="cc-scroll"
      data-testid="cc-scroll"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      }}
      ref={ref}
    >
      <div className="cc-scroll-in">
        {messages.length === 0 ? (
          <div className="cc-first">
            <div className="cc-first-t">{"想让 Claude Code 做什么？"}</div>
            <div className="cc-first-s">{"比如「写一个 Python 脚本，把 CSV 转成 JSON」。只读操作和会话目录里的改动直接做；运行命令前会先问你。"}</div>
          </div>
        ) : (
          messages.map((m, i) => <CcMessageView key={m.id} message={m} onOpenDiff={onOpenDiff} statusText={i === messages.length - 1 ? statusText : null} />)
        )}
      </div>
    </div>
  );
}

function Composer({
  sessionId,
  session,
  running,
  onStop,
  stopState,
  phone,
}: {
  sessionId: string;
  session: { model: string | null; effort: string | null };
  running: boolean;
  onStop: () => void;
  stopState: ReturnType<typeof useAsyncAction>["state"];
  phone: boolean;
}) {
  const [text, setText] = useState("");
  const queryClient = useQueryClient();
  const area = useRef<HTMLTextAreaElement>(null);
  const send = useAsyncAction(
    async () => {
      const value = text.trim();
      if (!value) return;
      setText("");
      try {
        await ccApi.send(sessionId, value);
      } catch (error) {
        setText(value);
        throw error;
      }
    },
    { errorToast: (e) => e.message },
  );
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, phone ? 140 : 220)}px`;
  }, [text, phone]);
  const patch = async (body: { model?: string | null; effort?: string | null }) => {
    try {
      await ccApi.patchSession(sessionId, body);
      await queryClient.invalidateQueries({ queryKey: ccKeys.workspaces });
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  return (
    <form
      className="glass-composer cc-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send.run();
      }}
    >
      <div className="cc-composer-pills">
        <label className="cc-select-pill">
          <span className="sr-only">{"模型"}</span>
          <select data-testid="cc-model" onChange={(e) => void patch({ model: e.target.value || null })} value={session.model ?? ""}>
            {CC_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="cc-select-pill">
          <span className="sr-only">{"努力程度"}</span>
          <select data-testid="cc-effort" onChange={(e) => void patch({ effort: e.target.value || null })} value={session.effort ?? ""}>
            <option value="">{"努力：默认"}</option>
            {CC_EFFORTS.map((e) => (
              <option key={e} value={e}>{`努力：${CC_EFFORT_ZH[e]}`}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="cc-composer-row">
        <textarea
          aria-label="和 Claude Code 说"
          data-testid="cc-input"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !phone) {
              e.preventDefault();
              void send.run();
            }
          }}
          placeholder={running ? "回答中也可以先写，发出后排队" : "和 Claude Code 说…"}
          ref={area}
          rows={1}
          value={text}
        />
        {running ? (
          <Button aria-label="停止" className="cc-send" data-testid="cc-stop" feedback={{ pending: "停止中…", success: "已停止", error: "没停下" }} onClick={onStop} size="icon-lg" state={stopState} type="button" variant="outline">
            <IconPlayerStopFilled className="size-4" />
          </Button>
        ) : null}
        <Button aria-label="发送" className="cc-send" data-testid="cc-send" disabled={!text.trim()} feedback="send" size="icon-lg" state={send.state} type="submit">
          <IconArrowUp className="size-5" />
        </Button>
      </div>
    </form>
  );
}

/** 手机底部抽屉：半屏 → 上拉全屏 → 下拉收起（DESIGN.md §73.6）。 */
function Drawer({ state, onState, children }: { state: "closed" | "half" | "full"; onState: (s: "closed" | "half" | "full") => void; children: React.ReactNode }) {
  const start = useRef<{ y: number; at: number } | null>(null);
  const [drag, setDrag] = useState(0);
  return (
    <>
      <div aria-hidden className={cn("cc-drawer-scrim", state !== "closed" && "is-shown")} onClick={() => onState("closed")} />
      <section aria-hidden={state === "closed"} aria-label="文件和改动" className="cc-drawer" data-state={state} data-testid="cc-drawer" inert={state === "closed"} style={drag ? { transform: `translateY(${Math.max(-200, drag)}px)`, transition: "none" } : undefined}>
        <div
          className="cc-drawer-handle"
          data-testid="cc-drawer-handle"
          onPointerCancel={() => {
            start.current = null;
            setDrag(0);
          }}
          onPointerDown={(e) => {
            start.current = { y: e.clientY, at: Date.now() };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (start.current) setDrag(e.clientY - start.current.y);
          }}
          onPointerUp={(e) => {
            const s = start.current;
            start.current = null;
            const dy = s ? e.clientY - s.y : 0;
            setDrag(0);
            if (Math.abs(dy) < 8) onState(state === "half" ? "full" : "half");
            else if (dy < -40) onState("full");
            else if (dy > 40) onState(state === "full" ? "half" : "closed");
          }}
        >
          <i />
        </div>
        <div className="cc-drawer-body">{children}</div>
      </section>
    </>
  );
}
