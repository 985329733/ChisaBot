import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { currentUserQueryOptions } from "@/lib/auth/queries";
import { LAST_CC_SESSION_KEY, rememberLeftMode } from "@/lib/cloud-cc";

/**
 * 左栏顶部「机器人｜Claude Code」（ADR-0014 修订 ADR-0001，DESIGN.md §73.2）。机器人那边仍然只放机器人。
 * 只有管理员看得到（Claude Code 用的是管理员自己的 Claude 订阅）。点了就换页面，并记住选择。
 */
export function LeftModeSwitch({ mode }: { mode: "bots" | "cc" }) {
  const user = useQuery(currentUserQueryOptions());
  const navigate = useNavigate();
  if (user.data?.role !== "admin") return null;
  const go = (next: "bots" | "cc") => {
    if (next === mode) return;
    rememberLeftMode(next);
    if (next === "bots") {
      void navigate({ to: "/" });
      return;
    }
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_CC_SESSION_KEY);
    } catch {}
    if (last) void navigate({ to: "/cc/$sessionId", params: { sessionId: last } });
    else void navigate({ to: "/cc" });
  };
  return (
    <div aria-label="左栏内容" className="sg-segmented cc-mode-switch" data-testid="left-mode-switch" role="radiogroup">
      <button aria-checked={mode === "bots"} className="sg-segmented-item" onClick={() => go("bots")} role="radio" type="button">
        {"机器人"}
      </button>
      <button aria-checked={mode === "cc"} className="sg-segmented-item" data-testid="left-mode-cc" onClick={() => go("cc")} role="radio" type="button">
        {"Claude Code"}
      </button>
    </div>
  );
}
