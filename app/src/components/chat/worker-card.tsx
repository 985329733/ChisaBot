import { useCopilotChatConfiguration } from "@copilotkit/react-core/v2";
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconLoader2,
  IconMessagePlus,
  IconPlayerStopFilled,
  IconSend2,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  ACTIVE_WORKER,
  formatElapsed,
  parseWorkerResult,
  useThreadWorkers,
  useWorkerAction,
  WORKER_STATUS_ZH,
  type WorkerView,
} from "@/lib/copilot/workers";

/**
 * 后台任务卡片（DESIGN.md §38.2，「思考提示框」）：机器人委派一件事时，在那条回复里出现一张紧凑的玻璃卡——
 * 标题、状态、当前步骤一行、可折叠的清单（✓ 已完成 · ● 正在做 · ○ 未开始 · ! 卡住）、用时，
 * 下面「补充说明」「停止」。做完收成一行结果，点它跳到交回来的那条结果消息。
 *
 * 不跳动：卡片外框高度只随清单展开 / 收起变化（grid 0fr→1fr 过渡），状态行原地换字；
 * 窄窗口（PC 小窗、手机）里按钮只留图标。
 */
export function WorkerCard({ workerId, pendingTitle }: { workerId?: string; pendingTitle?: string }) {
  const chat = useCopilotChatConfiguration();
  const threadId = chat?.threadId;
  const workers = useThreadWorkers(threadId);
  const worker = workerId ? workers.data?.find((item) => item.id === workerId) : undefined;
  // 刚委派、列表里还没有它：马上再取一次（之后有任务在跑就自动轮询）。
  useEffect(() => {
    if (workerId && workers.data && !worker) {
      const timer = setTimeout(() => void workers.refetch(), 400);
      return () => clearTimeout(timer);
    }
  }, [workerId, worker, workers]);
  if (!worker) {
    return (
      <div className="worker-card is-pending" data-testid="worker-card" data-status="pending">
        <div className="worker-head">
          <span className="worker-icon is-running">
            <IconLoader2 className="size-4" />
          </span>
          <span className="worker-title">{pendingTitle || "后台任务"}</span>
          <span className="worker-chip">{"正在交给后台…"}</span>
        </div>
      </div>
    );
  }
  return <WorkerCardBody threadId={threadId!} worker={worker} />;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function WorkerCardBody({ threadId, worker }: { threadId: string; worker: WorkerView }) {
  const active = ACTIVE_WORKER.includes(worker.status);
  const now = useNow(active);
  const [planOpen, setPlanOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [steering, setSteering] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"" | "steer" | "cancel">("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const act = useWorkerAction(threadId);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (steering) input.current?.focus();
  }, [steering]);

  const started = worker.startedAt ? Date.parse(worker.startedAt) : Date.parse(worker.createdAt);
  const ended = worker.finishedAt ? Date.parse(worker.finishedAt) : now;
  const elapsed = formatElapsed(ended - started);
  const done = worker.plan.filter((step) => step.status === "done").length;

  const run = async (kind: "steer" | "cancel") => {
    setBusy(kind);
    setError("");
    try {
      await act(worker.id, kind, kind === "steer" ? note.trim() : undefined);
      if (kind === "steer") {
        setNote("");
        setSteering(false);
        setSent(true);
        setTimeout(() => setSent(false), 2400);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "操作失败");
    } finally {
      setBusy("");
    }
  };

  const openResult = () => {
    const id = worker.resultMessageId;
    const target = id ? document.querySelector(`[data-message-id="${CSS.escape(id)}"]`) : null;
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("is-flash");
      setTimeout(() => target.classList.remove("is-flash"), 1200);
    } else setExpanded((value) => !value);
  };

  // 结束了：收成一行（点「详情」再展开清单看过程）。
  if (!active && !expanded) {
    const ok = worker.status === "done";
    return (
      <div className={cn("worker-card is-collapsed", `is-${worker.status}`)} data-status={worker.status} data-testid="worker-card">
        <button className="worker-line" onClick={openResult} title={worker.resultMessageId ? "跳到结果" : "展开"} type="button">
          <span className={cn("worker-icon", ok ? "is-done" : "is-failed")}>
            {ok ? <IconCheck className="size-3.5" stroke={2.5} /> : worker.status === "cancelled" ? <IconPlayerStopFilled className="size-3" /> : <IconAlertTriangle className="size-3.5" />}
          </span>
          <span className="worker-title">{worker.title}</span>
          <span className="worker-line-text">
            {ok ? worker.summary || "已完成" : worker.status === "cancelled" ? "已停止" : worker.error || "没有完成"}
          </span>
          <span className="worker-time">{elapsed}</span>
        </button>
        {worker.plan.length ? (
          <button aria-label={"展开详情"} className="worker-more" onClick={() => setExpanded(true)} title={"详情"} type="button">
            <IconChevronDown className="size-3.5" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn("worker-card", `is-${worker.status}`)} data-status={worker.status} data-testid="worker-card">
      <div className="worker-head">
        <span className={cn("worker-icon", active ? "is-running" : worker.status === "done" ? "is-done" : "is-failed")}>
          {active ? <IconLoader2 className="size-4" /> : worker.status === "done" ? <IconCheck className="size-3.5" stroke={2.5} /> : <IconAlertTriangle className="size-3.5" />}
        </span>
        <span className="worker-title">{worker.title}</span>
        <span className={cn("worker-chip", `is-${worker.status}`)} data-testid="worker-status">
          {WORKER_STATUS_ZH[worker.status]}
        </span>
        <span className="worker-time">{elapsed}</span>
        {!active ? (
          <button aria-label={"收起"} className="worker-more" onClick={() => setExpanded(false)} title={"收起"} type="button">
            <IconChevronDown className="size-3.5 rotate-180" />
          </button>
        ) : null}
      </div>
      <div className="worker-step" data-testid="worker-step" key={worker.step ?? worker.status}>
        {active
          ? worker.status === "queued"
            ? "排队中，前面的任务做完就开始"
            : worker.step || "正在准备"
          : worker.status === "done"
            ? worker.summary || "已完成"
            : worker.error || WORKER_STATUS_ZH[worker.status]}
      </div>
      {worker.plan.length ? (
        <div className="worker-plan-wrap">
          <button aria-expanded={planOpen} className="worker-plan-toggle" onClick={() => setPlanOpen((value) => !value)} type="button">
            <IconChevronDown className={cn("size-3.5 transition-transform", !planOpen && "-rotate-90")} />
            {`步骤 ${done}/${worker.plan.length}`}
          </button>
          <div className="worker-plan-collapse" data-open={planOpen || undefined}>
            <ol className="worker-plan" data-testid="worker-plan">
              {worker.plan.map((step, index) => (
                <li className={cn("worker-plan-step", `is-${step.status}`)} key={`${index}-${step.text}`}>
                  <span className="worker-plan-mark" aria-hidden>
                    {step.status === "done" ? <IconCheck className="size-3" stroke={2.75} /> : step.status === "blocked" ? "!" : null}
                  </span>
                  <span className="worker-plan-text">{step.text}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}
      {active ? (
        <div className="worker-actions">
          {steering ? (
            <form
              className="worker-steer"
              onSubmit={(event) => {
                event.preventDefault();
                if (note.trim() && !busy) void run("steer");
              }}
            >
              <input
                aria-label={"给这个后台任务补充说明"}
                className="worker-steer-input"
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setSteering(false);
                }}
                placeholder={"补充说明，例如：只看 2026 年的"}
                ref={input}
                value={note}
              />
              <button className="worker-btn is-primary" disabled={!note.trim() || busy === "steer"} title={"发送"} type="submit">
                {busy === "steer" ? <IconLoader2 className="size-3.5 animate-spin" /> : <IconSend2 className="size-3.5" />}
                <span className="worker-btn-label">{"发送"}</span>
              </button>
              <button aria-label={"取消"} className="worker-btn" onClick={() => setSteering(false)} title={"取消"} type="button">
                <IconX className="size-3.5" />
              </button>
            </form>
          ) : (
            <>
              <button className="worker-btn" data-testid="worker-steer" onClick={() => setSteering(true)} title={"补充说明"} type="button">
                {sent ? <IconCheck className="size-3.5" /> : <IconMessagePlus className="size-3.5" />}
                <span className="worker-btn-label">{sent ? "已发送" : "补充说明"}</span>
              </button>
              <button
                className="worker-btn is-danger"
                data-testid="worker-cancel"
                disabled={busy === "cancel"}
                onClick={() => void run("cancel")}
                title={"停止这个后台任务"}
                type="button"
              >
                {busy === "cancel" ? <IconLoader2 className="size-3.5 animate-spin" /> : <IconPlayerStopFilled className="size-3" />}
                <span className="worker-btn-label">{busy === "cancel" ? "停止中…" : "停止"}</span>
              </button>
            </>
          )}
        </div>
      ) : null}
      {error ? <div className="worker-error">{error}</div> : null}
    </div>
  );
}

/**
 * 交回来的结果消息（role=user，开头是标记）不画成用户气泡：一行「后台任务「x」已完成」，点开看全文。
 * 主机器人接着用一两句话总结它，那才是用户要读的。
 */
export function WorkerResultRow({ messageId, text }: { messageId: string; text: string }) {
  const parsed = parseWorkerResult(text);
  const [open, setOpen] = useState(false);
  if (!parsed) return null;
  const ok = parsed.status === "done";
  return (
    <div className={cn("worker-result", ok ? "is-done" : "is-failed")} data-message-id={messageId} data-testid="worker-result">
      <button aria-expanded={open} className="worker-result-line" onClick={() => setOpen((value) => !value)} type="button">
        <span className={cn("worker-icon", ok ? "is-done" : "is-failed")}>
          {ok ? <IconCheck className="size-3.5" stroke={2.5} /> : <IconAlertTriangle className="size-3.5" />}
        </span>
        <span className="worker-result-head">{parsed.headline.replace(/。$/, "")}</span>
        <span className="worker-result-hint">{open ? "收起" : "查看结果"}</span>
        <IconChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      <div className="worker-plan-collapse" data-open={open || undefined}>
        <div className="worker-result-body">{parsed.body}</div>
      </div>
    </div>
  );
}
