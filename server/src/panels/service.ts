import type { MiddlewareHandler } from "hono";
import type { Database } from "../db/client";
import type { AppVariables } from "../auth/guards";
import { PanelError, type ActorContext } from "../../../shared/panels/types";
import { createPanelStore } from "./store";
import { createPanelAuthoring } from "./authoring";
import { createPanelBroker, type PanelAdapter } from "./broker";
import { createPanelRoutes } from "./routes";
export function createPanelServices(options: {
  database: Database;
  permissions(
    ctx: ActorContext,
  ): Promise<{ canManage: boolean; canInteract: boolean }>;
  adapters: readonly PanelAdapter[];
  audit(event: Record<string, unknown>): Promise<void>;
}) {
  async function permissions(ctx: ActorContext) {
    if (!ctx.actorId || !ctx.botId)
      throw new PanelError("unauthenticated", 401);
    try {
      const p = await options.permissions(Object.freeze({ ...ctx }));
      if (!p.canInteract) throw new PanelError("panel_permission_refused", 403);
      return p;
    } catch (error) {
      if (error instanceof PanelError) throw error;
      throw new PanelError("panel_permission_refused", 403);
    }
  }
  async function authorize(ctx: ActorContext, manage = false) {
    const p = await permissions(ctx);
    if (manage && !p.canManage)
      throw new PanelError("panel_permission_refused", 403);
  }
  async function audit(event: Record<string, unknown>) {
    try {
      await options.audit(event);
    } catch {
      throw new PanelError("panel_audit_unavailable", 503);
    }
  }
  const store = createPanelStore(options.database),
    authoring = createPanelAuthoring({ store, authorize, audit }),
    broker = createPanelBroker({
      database: options.database,
      store,
      authorize,
      adapters: options.adapters,
      audit,
    });
  return {
    store,
    authoring,
    broker,
    permissions,
    routes: (requireUser: MiddlewareHandler<{ Variables: AppVariables }>) =>
      createPanelRoutes({
        store,
        authoring,
        broker,
        permissions,
        requireUser,
        audit,
      }),
  };
}
export type PanelServices = ReturnType<typeof createPanelServices>;
