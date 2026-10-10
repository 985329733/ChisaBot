import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  issueCallbackTokenMutationOptions,
  revokeCallbackTokenMutationOptions,
} from "@/lib/agents/mutations";

/**
 * The credential this coworker presents when it calls a tool back.
 *
 * Only for a coworker that runs somewhere else. The Bot in the box has no endpoint and nothing to
 * authenticate as, and offering it a token would imply otherwise.
 *
 * Shown once, and said plainly. This deployment keeps a hash, so there is no screen that can show the
 * token again: an operator who loses it rotates, and rotating retires the old one, which is also how a
 * leak is handled.
 *
 * A coworker with no token can still hold a conversation. What it cannot do is reach anything outside
 * one, which is the right default for a URL somebody pasted.
 */
export function CallbackTokenPanel({
  agentId,
  hasToken,
}: {
  agentId: string;
  hasToken: boolean;
}) {
  const queryClient = useQueryClient();
  const issue = useMutation(issueCallbackTokenMutationOptions(queryClient));
  const revoke = useMutation(revokeCallbackTokenMutationOptions(queryClient));

  /** Held in state, not in a query cache: it must not survive a refetch or a navigation. */
  const [token, setToken] = useState<string | null>(null);
  const error = issue.error ?? revoke.error;

  return (
    <section className="mt-6 grid gap-2">
      <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {"调用工具"}
      </h2>

      <p className="text-muted-foreground text-sm">
        {hasToken
          ? "此 AI 同事持有凭证，因此可以使用已授权的工具。轮换会替换它，旧的会立即停止工作。"
          : "此 AI 同事没有凭证，因此可以保持会话但无法使用已授权的任何工具。生成一个并放入该代理的配置中。"}
      </p>

      {token ? (
        <div className="grid gap-2 rounded-lg border border-border bg-card p-3">
          <p className="font-medium text-sm">
            {"现在复制它。它不会再次显示。"}
          </p>
          {/*
           * Selectable and wrapped rather than a copy button alone: somebody pasting this into a
           * deployment config on another machine may not have a clipboard between the two.
           */}
          <code className="block break-all rounded bg-foreground/5 p-2 font-mono text-xs">
            {token}
          </code>
          <p className="text-muted-foreground text-xs">
            {"部署仅保留其哈希，因此此处无法再次向您展示它。"}
          </p>
          <Button onClick={() => setToken(null)} size="sm" variant="outline">
            {"完成"}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            feedback="generate"
            mutation={issue}
            onClick={async () => setToken(await issue.mutateAsync(agentId))}
            size="sm"
            variant="outline"
          >
            {hasToken ? "旋转令牌" : "生成令牌"}
          </Button>
          {hasToken ? (
            <Button
              feedback="revoke"
              mutation={revoke}
              onClick={() => revoke.mutate(agentId)}
              size="sm"
              variant="outline"
            >
              {"撤销"}
            </Button>
          ) : null}
        </div>
      )}

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error.message}
        </p>
      ) : null}
    </section>
  );
}
