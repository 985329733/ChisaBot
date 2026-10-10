import { toast } from "@/components/ui/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChannelItemContent } from "@/components/app-sidebar/channel-item-content";
import { PageRows } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
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
  saveUserPreferencesMutationOptions,
  useUserPreferences,
} from "@/lib/settings/message-list";

export function MessageListPreference() {
  const preferences = useUserPreferences();
  const queryClient = useQueryClient();
  const save = useMutation(
    saveUserPreferencesMutationOptions(queryClient, preferences.userId),
  );
  const emphasis =
    (save.isPending ? save.variables?.messageListEmphasis : undefined) ??
    preferences.data?.messageListEmphasis;

  return (
    <PageRows>
      <Item size="sm">
        <ItemContent>
          <ItemTitle>{"消息列表强调"}</ItemTitle>
          <ItemDescription>
            {"选择哪个名称在侧边栏中显示更大。"}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Select
            value={emphasis ?? null}
            disabled={!preferences.data || save.isPending}
            onValueChange={(value) => {
              if (value === "agent" || value === "thread") {
                save.mutate(
                  { messageListEmphasis: value },
                  {
                    onSuccess: () => toast.success("已保存"),
                    onError: (thrown: Error) => toast.error(`保存失败：${thrown.message}`),
                  },
                );
              }
            }}
          >
            <SelectTrigger aria-label={"消息列表强调"}>
              <SelectValue>
                {emphasis
                  ? emphasis === "agent"
                    ? "代理名称"
                    : "线程标题"
                  : "正在加载…"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="thread">{"线程标题"}</SelectItem>
              <SelectItem value="agent">{"代理名称"}</SelectItem>
            </SelectContent>
          </Select>
        </ItemActions>
      </Item>
      {preferences.isError ? (
        <div className="px-3 pb-3">
          <p role="alert" className="text-sm text-destructive">
            {preferences.error.message}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void preferences.refetch()}
          >
            {"重试"}
          </Button>
        </div>
      ) : null}
      {save.isError ? (
        <p role="alert" className="px-3 pb-3 text-sm text-destructive">
          {save.error.message}
        </p>
      ) : null}
      {save.isPending ? (
        <p role="status" className="px-3 text-sm text-muted-foreground">
          {"正在保存…"}
        </p>
      ) : null}
      {emphasis ? (
        <div className="flex justify-center px-6 pt-3 pb-6">
          <figure
            aria-label={"消息列表预览"}
            className="flex h-16 w-full max-w-xs items-center rounded-lg border border-border bg-sidebar px-3"
          >
            <ChannelItemContent
              participantIds={["message-list-preview"]}
              name="General Assistant"
              title={"计划下周"}
              lastMessageAt="2h"
              emphasis={emphasis}
            />
          </figure>
        </div>
      ) : null}
    </PageRows>
  );
}
