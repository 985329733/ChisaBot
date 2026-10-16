import { memo, useCallback, useLayoutEffect, useRef } from "react";
import { BotProfileForm } from "@/components/agents/bot-profile-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * 新建机器人：一张表，一步完成（DESIGN.md §46，2026-10-14 用户：「创建机器人第二步…不需要」
 * 「所有的机器人都是私有」「创建就是在服务器上创建」）。
 *
 * 以前是三步向导：名字和角色 → 谁可以看到它（私有 / 公开）→ 它在哪里运行（内置 / 自托管端点）。
 * 2026-10-16 起（DESIGN.md §81，用户：「创建的时候没有职责，修改信息里就有了。而且任何地方都没有创建头像和上传头像的地方。」）
 * 新建和编辑是同一张表 `BotProfileForm`：头像 · 名称（必填）· 职责（按「它做什么」自动写，可改）· 它做什么（提示词）。
 * 机器人一律私有（服务器也强制），一律在这台服务器上运行。文字框从空白开始，没有示例或模板。
 */
export function CreateAgentDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** The new coworker's id, so the caller can open its dialog on it. */
  onCreated: (agentId: string) => void;
}) {
  /*
   * Closing must not re-render the wizard (DESIGN.md §37). Callers pass fresh arrow functions on
   * every render, and the close itself re-renders the caller, so the wizard gets callbacks that
   * never change identity and is memoised: the only work a close does is the exit animation.
   */
  const latest = useRef({ onClose, onCreated });
  useLayoutEffect(() => {
    latest.current = { onClose, onCreated };
  });
  const close = useCallback(() => latest.current.onClose(), []);
  const created = useCallback(
    (agentId: string) => latest.current.onCreated(agentId),
    [],
  );
  return (
    <Dialog onOpenChange={(next) => !next && close()} open={open}>
      <DialogContent>
        {/* All wizard state lives below DialogContent, whose portal unmounts on close: dismissing
            the dialog mid-way discards the half-answered steps rather than pickling them. */}
        <CreateAgentWizard onClose={close} onCreated={created} />
      </DialogContent>
    </Dialog>
  );
}

const CreateAgentWizard = memo(function CreateAgentWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (agentId: string) => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{"新建机器人"}</DialogTitle>
        <DialogDescription>
          {"只有你能看到和使用它，在服务器上运行。之后在机器人资料里都能改。"}
        </DialogDescription>
      </DialogHeader>
      {/* 表单自己分成可滚动的字段区 + 固定在底部的按钮（矮屏上「创建」不被顶出窗口）。 */}
      <BotProfileForm autoFocus onCancel={onClose} onSaved={onCreated} />
    </>
  );
});
