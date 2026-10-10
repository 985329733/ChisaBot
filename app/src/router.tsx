import { createRouter } from "@tanstack/react-router";
import { StartupFailure, StartupPending } from "./components/startup-status";
import type { RouterContext } from "./router-context";
import { routeTree } from "./routeTree.gen";

export const router = createRouter({
  routeTree,
  context: {} as RouterContext,
  /*
   * Boot shows the sky skeleton at once (it matches the static index.html, so nothing flashes).
   * Within the app a lazy route keeps its shell: `StartupPending` draws an inline skeleton when a
   * shell is on screen. No minimum pending time — a chunk that arrives in 40ms should not be held on
   * screen for 500ms — and links preload their route chunk on hover/focus so most clicks never
   * suspend at all.
   */
  defaultPendingMs: 0,
  defaultPendingMinMs: 0,
  defaultPreload: "intent",
  defaultPendingComponent: StartupPending,
  defaultErrorComponent: StartupFailure,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
