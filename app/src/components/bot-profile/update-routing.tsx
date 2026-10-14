import { IconRoute } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { PageRows, PageSection, PageSkeleton } from "@/components/layout/page-shell";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { setUpdateRoutingMutationOptions } from "@/lib/bot-lifecycle/mutations";
import {
  type UpdateKind,
  type UpdateTransport,
  updateRoutingQueryOptions,
} from "@/lib/bot-lifecycle/queries";
import { queryClient } from "@/query-client";

/*
 * 每种更新发到哪里（对你所有的机器人生效）。以前放在每个机器人的资料页里，2026-10-14 资料页精简时
 * 搬到「通知 / 可达性」页（DESIGN.md §46）：它不属于某一个机器人。
 */
const KIND_LABEL: Record<UpdateKind, { title: string; description: string }> = {
  progress: {
    title: "进度",
    description: "你没在看的工作的回复和结果。",
  },
  decision: {
    title: "决策",
    description: "机器人动手前需要你批准的事。",
  },
  question: {
    title: "问题",
    description: "机器人在问你、正等你回答的事。",
  },
};

const TRANSPORTS: { id: UpdateTransport; label: string }[] = [
  { id: "push", label: "推送" },
  { id: "slack", label: "Slack" },
  { id: "teams", label: "Microsoft Teams" },
  { id: "sms", label: "短信" },
];

export function UpdateRoutingSection() {
  const routing = useQuery(updateRoutingQueryOptions());
  const save = useMutation(setUpdateRoutingMutationOptions(queryClient));
  return (
    <PageSection
      description={
        "你不在时，每种更新发到哪里。网页上始终能看到全部；对你所有的机器人生效。"
      }
      title={"更新发到哪里"}
    >
      {routing.isPending ? <PageSkeleton /> : routing.error ? (
        <p className="mt-4 text-destructive text-sm" role="alert">
          {"无法加载更新去向。"}
        </p>
      ) : (
        <PageRows>
          {(Object.keys(KIND_LABEL) as UpdateKind[]).map((kind, index) => {
            const current = routing.data[kind];
            const allowed = (transport: UpdateTransport) =>
              current === "all" || current.includes(transport);
            return (
              <Fragment key={kind}>
                {index > 0 ? <Separator /> : null}
                <Item size="sm">
                  <ItemMedia variant="icon">
                    <IconRoute />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{KIND_LABEL[kind].title}</ItemTitle>
                    <ItemDescription>
                      {KIND_LABEL[kind].description}
                    </ItemDescription>
                  </ItemContent>
                  <ItemFooter className="gap-4 pl-8">
                    {TRANSPORTS.map((transport) => (
                      <div
                        className="flex items-center gap-2 text-sm"
                        key={transport.id}
                      >
                        <Switch
                          aria-label={`${KIND_LABEL[kind].title} 由 ${transport.label}`}
                          checked={allowed(transport.id)}
                          disabled={save.isPending}
                          onCheckedChange={(checked) => {
                            const next = TRANSPORTS.map((t) => t.id).filter(
                              (id) =>
                                id === transport.id ? checked : allowed(id),
                            );
                            save.mutate({
                              kind,
                              transports:
                                next.length === TRANSPORTS.length
                                  ? "all"
                                  : next,
                            });
                          }}
                          size="sm"
                        />
                        {transport.label}
                      </div>
                    ))}
                  </ItemFooter>
                </Item>
              </Fragment>
            );
          })}
        </PageRows>
      )}
    </PageSection>
  );
}

