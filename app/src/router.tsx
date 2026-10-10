import { createRouter } from "@tanstack/react-router";
import { StartupFailure, StartupPending } from "./components/startup-status";
import type { RouterContext } from "./router-context";
import { routeTree } from "./routeTree.gen";

export const router = createRouter({
  routeTree,
  context: {} as RouterContext,
  defaultPendingMs: 0,
  defaultPendingComponent: StartupPending,
  defaultErrorComponent: StartupFailure,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
