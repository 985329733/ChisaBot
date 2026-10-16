import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { stashFirstMessage } from "@/components/channels/transcript-messages";
import { createChannelMutationOptions } from "./mutations";
import { channelKeys } from "./queries";

/**
 * Start a channel from a just-submitted first message, then navigate there.
 *
 * Ordering matters: create, seed the channel cache, stash the first message, then navigate. That
 * keeps the first message visible while the channel thread joins.
 */
export function useStartChannel() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const createChannel = useMutation(createChannelMutationOptions(queryClient));

  /**
   * `watch`: the empty chat already had the Bot's 计算机 open in the right column (DESIGN.md §79);
   * carry it into the new conversation so the screen does not close under the first message.
   */
  const start = async (agentId: string, text: string, options: { watch?: boolean } = {}) => {
    const channel = await createChannel.mutateAsync([agentId]);
    queryClient.setQueryData(channelKeys.detail(channel.id), channel);
    stashFirstMessage(channel.id, text);
    await navigate({
      params: { channelId: channel.id },
      replace: true,
      ...(options.watch ? { search: { watch: true } } : {}),
      to: "/channel/$channelId",
    });
  };

  return {
    pending: createChannel.isPending,
    start,
    /** Same as `start`. The upstream intent-routing audit row (`POST /api/route`) is gone (slimming P4b). */
    startChosen: start,
  };
}
