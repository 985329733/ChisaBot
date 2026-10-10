import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { modelSelectionKeys } from "./queries";
import { listenForModelSelectionChanges } from "./sync";

export function useModelSelectionSaving(agentId: string) {
  return useIsMutating({ mutationKey: modelSelectionKeys.save(agentId) }) > 0;
}

export function useModelSelectionSync() {
  const queryClient = useQueryClient();
  useEffect(() => listenForModelSelectionChanges(queryClient), [queryClient]);
}
