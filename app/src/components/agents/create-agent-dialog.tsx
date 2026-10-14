import { useMutation } from "@tanstack/react-query";
import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type AgentFormValues,
  agentFormSchema,
  agentInputFrom,
  emptyAgentForm,
} from "@/lib/agents/form";
import { createAgentMutationOptions } from "@/lib/agents/mutations";
import { isComposing } from "@/lib/composing";
import { queryClient } from "@/query-client";

/**
 * 新建机器人：一张表，一步完成（DESIGN.md §46，2026-10-14 用户：「创建机器人第二步…不需要」
 * 「所有的机器人都是私有」「创建就是在服务器上创建」）。
 *
 * 以前是三步向导：名字和角色 → 谁可以看到它（私有 / 公开）→ 它在哪里运行（内置 / 自托管端点）。
 * 现在只问名字、职责和提示词：机器人一律私有（服务器也强制），一律在这台服务器上运行（不再提供
 * 自托管端点）。提示词从空白开始，没有「财务 / 报销」之类的示例或模板，由用户自己写。
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

/** 这张表要校验的字段，和服务器的上限一致。 */
const identitySchema = agentFormSchema.pick({
  name: true,
  title: true,
  roleDescription: true,
});

type IdentityField = keyof typeof identitySchema.shape;

/** 每个字段的第一条错误；通过时为空。 */
function identityIssues(
  values: AgentFormValues,
): Partial<Record<IdentityField, string>> {
  const parsed = identitySchema.safeParse(values);
  if (parsed.success) return {};
  const issues: Partial<Record<IdentityField, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as IdentityField | undefined;
    if (field && !issues[field]) issues[field] = issue.message;
  }
  return issues;
}

const CreateAgentWizard = memo(function CreateAgentWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (agentId: string) => void;
}) {
  const createAgent = useMutation(createAgentMutationOptions(queryClient));
  /** 按过「创建」之后才显示字段错误。 */
  const [tried, setTried] = useState(false);
  const [values, setValues] = useState<AgentFormValues>(emptyAgentForm);
  const set = <K extends keyof AgentFormValues>(
    key: K,
    value: AgentFormValues[K],
  ) => setValues((current) => ({ ...current, [key]: value }));

  const errors = tried ? identityIssues(values) : {};

  const submit = async () => {
    if (!identitySchema.safeParse(values).success) {
      setTried(true);
      return;
    }
    // 一律私有、一律在这台服务器上运行：不带端点，不带密钥。
    const agent = await createAgent.mutateAsync(
      agentInputFrom({
        ...values,
        visibility: "private",
        endpoint: "",
        authValue: "",
      }),
    );
    onCreated(agent.id);
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      noValidate
      onKeyDown={(event) => {
        // 输入框里按 Enter = 创建；提示词（textarea）里 Enter 换行；输入法确认字的 Enter 不算。
        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !isComposing(event) &&
          event.target instanceof HTMLInputElement
        ) {
          event.preventDefault();
          void submit().catch(() => undefined);
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void submit().catch(() => undefined);
      }}
    >
      <DialogHeader>
        <DialogTitle>{"新建机器人"}</DialogTitle>
        <DialogDescription>
          {"只有你能看到和使用它，在服务器上运行。"}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="mt-4 overflow-y-auto">
        <FieldGroup>
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="create-agent-name">{"名称"}</FieldLabel>
            <Input
              aria-invalid={errors.name ? true : undefined}
              autoComplete="off"
              autoFocus
              id="create-agent-name"
              onChange={(event) => set("name", event.target.value)}
              placeholder={"给它起个名字"}
              value={values.name}
            />
            {errors.name ? (
              <FieldError errors={[{ message: errors.name }]} />
            ) : null}
          </Field>
          <Field data-invalid={errors.title ? true : undefined}>
            <FieldLabel htmlFor="create-agent-title">{"职责"}</FieldLabel>
            <Input
              aria-invalid={errors.title ? true : undefined}
              autoComplete="off"
              id="create-agent-title"
              onChange={(event) => set("title", event.target.value)}
              placeholder={"一句话说明它负责什么"}
              value={values.title}
            />
            {errors.title ? (
              <FieldError errors={[{ message: errors.title }]} />
            ) : null}
          </Field>
          <Field data-invalid={errors.roleDescription ? true : undefined}>
            <FieldLabel htmlFor="create-agent-role">{"提示词"}</FieldLabel>
            <Textarea
              aria-invalid={errors.roleDescription ? true : undefined}
              className="min-h-32"
              id="create-agent-role"
              onChange={(event) => set("roleDescription", event.target.value)}
              placeholder={"写下它的工作说明：它是谁、做什么、怎么回答。"}
              rows={5}
              value={values.roleDescription}
            />
            {errors.roleDescription ? (
              <FieldError errors={[{ message: errors.roleDescription }]} />
            ) : null}
          </Field>
        </FieldGroup>
        {createAgent.error ? (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {createAgent.error.message}
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter className="mt-6">
        <Button onClick={onClose} type="button" variant="outline">
          {"取消"}
        </Button>
        <Button feedback="create" mutation={createAgent} type="submit">
          {"创建机器人"}
        </Button>
      </DialogFooter>
    </form>
  );
});
