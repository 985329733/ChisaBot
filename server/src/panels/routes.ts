import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { PanelError, type ActorContext } from "../../../shared/panels/types";
import { validatePanelDefinition } from "../../../shared/panels/validate";
import type { AppVariables } from "../auth/guards";
import type { PanelStore } from "./store";
import type { PanelAuthoring } from "./authoring";
import type { PanelBroker } from "./broker";
const id = z.string().min(1).max(128),
  version = z.number().int().positive(),
  key = id;
const commit = z
  .object({
    draftId: id,
    expectedDraftRevision: version,
    baseInstanceVersion: version.optional(),
    baseLibraryVersion: version.optional(),
    libraryId: id.optional(),
    mode: z.enum(["first", "instance", "new-library", "update-library"]),
    idempotencyKey: key,
    resetState: z.boolean(),
  })
  .strict();
export function createPanelRoutes(options: {
  store: PanelStore;
  authoring: PanelAuthoring;
  broker: PanelBroker;
  requireUser: MiddlewareHandler<{ Variables: AppVariables }>;
  permissions(
    ctx: ActorContext,
  ): Promise<{ canManage: boolean; canInteract: boolean }>;
  audit?: (event: Record<string, unknown>) => Promise<void>;
}) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", options.requireUser, bodyLimit({ maxSize: 600 * 1024 }));
  app.use("*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method))
      await options.audit?.({
        actorId: c.var.actor.id,
        operation: c.req.method,
        resource: c.req.path,
      });
    await next();
  });
  app.onError((error, c) =>
    c.json(
      {
        error:
          error instanceof PanelError
            ? error.code
            : error instanceof z.ZodError
              ? "invalid_panel_request"
              : "panel_operation_failed",
      },
      (error instanceof PanelError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : 500) as ContentfulStatusCode,
    ),
  );
  const actor = (c: {
    var: AppVariables;
    req: { param(name: string): string | undefined };
  }): ActorContext => ({
    actorId: c.var.actor.id,
    botId: id.parse(c.req.param("botId")),
    isAdmin: c.var.actor.role === "admin",
  });
  async function access(ctx: ActorContext, manage = false) {
    const p = await options.permissions(ctx);
    if (!p.canInteract || (manage && !p.canManage))
      throw new PanelError("panel_permission_refused", 403);
    return p;
  }
  const page = (c: { req: { query(name: string): string | undefined } }) => ({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .parse(c.req.query("limit") ?? 20),
    offset: z.coerce
      .number()
      .int()
      .nonnegative()
      .max(1000000)
      .parse(c.req.query("offset") ?? 0),
  });
  app.get("/_drafts/:draftId", async (c) => {
    const draft = await options.store.draftForActor(
      c.var.actor.id,
      id.parse(c.req.param("draftId")),
    );
    await access(
      {
        actorId: c.var.actor.id,
        botId: draft.botId,
        isAdmin: c.var.actor.role === "admin",
      },
      true,
    );
    return c.json({ result: draft });
  });
  app.get("/:botId", async (c) => {
    const ctx = actor(c),
      permissions = await access(ctx),
      p = page(c);
    const items = await options.store.list(ctx, p.limit, p.offset);
    return c.json({
      result: {
        items,
        nextOffset: items.length === p.limit ? p.offset + p.limit : null,
        ...permissions,
      },
    });
  });
  app.get("/:botId/library", async (c) => {
    const ctx = actor(c);
    await access(ctx);
    const p = page(c),
      items = await options.store.listLibrary(ctx, p.limit, p.offset);
    return c.json({
      result: {
        items: items.map((x) => ({
          ...x,
          canManage: x.creatorActorId === ctx.actorId || ctx.isAdmin === true,
        })),
        nextOffset: items.length === p.limit ? p.offset + p.limit : null,
      },
    });
  });
  app.get("/:botId/authoring", async (c) => {
    const ctx = actor(c);
    await access(ctx, true);
    return c.json({ result: await options.store.activeSession(ctx) });
  });
  app.post("/:botId/authoring", async (c) => {
    const ctx = actor(c),
      input = z
        .object({ targetInstanceId: id.optional() })
        .strict()
        .parse(await c.req.json());
    return c.json({
      result: await options.authoring.beginPanelAuthoring(
        ctx,
        input.targetInstanceId,
      ),
    });
  });
  app.delete("/:botId/authoring/:sessionId", async (c) => {
    const ctx = actor(c);
    await access(ctx, true);
    await options.store.cancelSession(ctx, id.parse(c.req.param("sessionId")));
    return c.json({ result: { ok: true } });
  });
  app.post("/:botId/drafts", async (c) => {
    const ctx = actor(c),
      input = z
        .object({
          sessionId: id,
          expectedDraftRevision: z.number().int().nonnegative(),
          definition: z.unknown(),
        })
        .strict()
        .parse(await c.req.json());
    return c.json({
      result: await options.authoring.proposePanelDraft(ctx, {
        ...input,
        definition: validatePanelDefinition(input.definition),
      }),
    });
  });
  app.get("/:botId/drafts/:draftId", async (c) => {
    const ctx = actor(c);
    await access(ctx, true);
    return c.json({
      result: await options.store.getDraft(
        ctx,
        id.parse(c.req.param("draftId")),
      ),
    });
  });
  app.post("/:botId/commit", async (c) =>
    c.json({
      result: await options.authoring.commit(
        actor(c),
        commit.parse(await c.req.json()),
      ),
    }),
  );
  app.get("/:botId/operations/:key", async (c) => {
    const ctx = actor(c);
    await access(ctx, true);
    return c.json({
      result: await options.store.operationResult(
        ctx,
        id.parse(c.req.param("key")),
      ),
    });
  });
  app.post("/:botId/install", async (c) => {
    const ctx = actor(c);
    await access(ctx, true);
    const input = z
      .object({ libraryId: id, libraryVersion: version, idempotencyKey: key })
      .strict()
      .parse(await c.req.json());
    return c.json({ result: await options.store.install(ctx, input) });
  });
  app.delete("/:botId/library/:libraryId", async (c) => {
    const ctx = actor(c);
    await access(ctx, true);
    const input = z
      .object({ expectedVersion: version })
      .strict()
      .parse(await c.req.json());
    await options.store.archiveLibrary(
      ctx,
      id.parse(c.req.param("libraryId")),
      input.expectedVersion,
    );
    return c.json({ result: { ok: true } });
  });
  app.patch("/:botId/instances/:instanceId", async (c) => {
    const ctx = actor(c);
    await access(ctx, true);
    const input = z
      .object({
        expectedVersion: version,
        title: z.string().min(1).max(80).optional(),
        collapsed: z.boolean().optional(),
        size: z
          .object({
            width: z.number().min(280).max(600),
            height: z.union([z.literal("auto"), z.number().min(160).max(960)]),
          })
          .strict()
          .optional(),
      })
      .strict()
      .parse(await c.req.json());
    return c.json({
      result: await options.store.updateLayout(ctx, {
        ...input,
        instanceId: id.parse(c.req.param("instanceId")),
      }),
    });
  });
  app.get("/:botId/instances/:instanceId", async (c) => {
    const ctx = actor(c);
    await access(ctx);
    return c.json({
      result: await options.store.getInstance(
        ctx,
        id.parse(c.req.param("instanceId")),
      ),
    });
  });
  app.delete("/:botId/instances/:instanceId", async (c) => {
    const ctx = actor(c);
    await access(ctx, true);
    const input = z
      .object({ expectedVersion: version })
      .strict()
      .parse(await c.req.json());
    await options.store.remove(
      ctx,
      id.parse(c.req.param("instanceId")),
      input.expectedVersion,
    );
    return c.json({ result: { ok: true } });
  });
  app.post("/:botId/reorder", async (c) => {
    const ctx = actor(c);
    await access(ctx, true);
    const input = z
      .object({
        items: z
          .array(z.object({ id, expectedVersion: version }).strict())
          .max(100),
      })
      .strict()
      .parse(await c.req.json());
    await options.store.reorder(ctx, input.items);
    return c.json({ result: { ok: true } });
  });
  app.get("/:botId/instances/:instanceId/history", async (c) => {
    const ctx = actor(c);
    await access(ctx, true);
    return c.json({
      result: await options.store.history(
        ctx,
        id.parse(c.req.param("instanceId")),
      ),
    });
  });
  app.post("/:botId/instances/:instanceId/rollback", async (c) => {
    const ctx = actor(c);
    await access(ctx, true);
    const input = z
      .object({
        expectedVersion: version,
        version,
        idempotencyKey: key,
        resetState: z.boolean(),
      })
      .strict()
      .parse(await c.req.json());
    return c.json({
      result: await options.store.rollback(ctx, {
        ...input,
        instanceId: id.parse(c.req.param("instanceId")),
      }),
    });
  });
  app.get("/:botId/instances/:instanceId/state", async (c) => {
    const ctx = actor(c);
    await access(ctx);
    return c.json({
      result: await options.store.readState(
        ctx,
        id.parse(c.req.param("instanceId")),
      ),
    });
  });
  app.put("/:botId/instances/:instanceId/state", async (c) => {
    const ctx = actor(c);
    await access(ctx);
    const input = z
      .object({
        instanceVersion: version,
        stateRevision: z.number().int().nonnegative(),
        value: z.unknown(),
        resetIncompatible: z.boolean().optional(),
      })
      .strict()
      .parse(await c.req.json());
    const value = JSON.parse(JSON.stringify(input.value));
    await options.store.writeState(ctx, {
      ...input,
      value,
      instanceId: id.parse(c.req.param("instanceId")),
    });
    return c.json({ result: { ok: true } });
  });
  app.get("/:botId/instances/:instanceId/grants", async (c) =>
    c.json({
      result: await options.broker.listGrants(
        actor(c),
        id.parse(c.req.param("instanceId")),
      ),
    }),
  );
  app.post("/:botId/instances/:instanceId/grants/:capabilityId", async (c) => {
    const input = z
      .object({ instanceVersion: version })
      .strict()
      .parse(await c.req.json());
    return c.json({
      result: await options.broker.approveCapability(
        actor(c),
        {
          botId: c.req.param("botId"),
          instanceId: id.parse(c.req.param("instanceId")),
          instanceVersion: input.instanceVersion,
        },
        id.parse(c.req.param("capabilityId")),
      ),
    });
  });
  app.delete(
    "/:botId/instances/:instanceId/grants/:capabilityId",
    async (c) => {
      await options.broker.revokeCapability(
        actor(c),
        id.parse(c.req.param("instanceId")),
        id.parse(c.req.param("capabilityId")),
      );
      return c.json({ result: { ok: true } });
    },
  );
  app.post("/:botId/instances/:instanceId/data/:capabilityId", async (c) => {
    const input = z
      .object({ instanceVersion: version, args: z.unknown() })
      .strict()
      .parse(await c.req.json());
    return c.json({
      result: await options.broker.readPanelData(
        actor(c),
        {
          botId: c.req.param("botId"),
          instanceId: id.parse(c.req.param("instanceId")),
          instanceVersion: input.instanceVersion,
        },
        id.parse(c.req.param("capabilityId")),
        JSON.parse(JSON.stringify(input.args)),
        c.req.raw.signal,
      ),
    });
  });
  app.post("/:botId/instances/:instanceId/tasks/:capabilityId", async (c) => {
    const input = z
      .object({
        instanceVersion: version,
        args: z.unknown(),
        idempotencyKey: key,
      })
      .strict()
      .parse(await c.req.json());
    return c.json({
      result: await options.broker.requestPanelTask(
        actor(c),
        {
          botId: c.req.param("botId"),
          instanceId: id.parse(c.req.param("instanceId")),
          instanceVersion: input.instanceVersion,
        },
        id.parse(c.req.param("capabilityId")),
        JSON.parse(JSON.stringify(input.args)),
        input.idempotencyKey,
      ),
    });
  });
  app.get("/:botId/instances/:instanceId/tasks", async (c) =>
    c.json({
      result: await options.broker.listPanelTasks(
        actor(c),
        id.parse(c.req.param("instanceId")),
      ),
    }),
  );
  app.get("/:botId/tasks/:taskId", async (c) =>
    c.json({
      result: await options.broker.queryPanelTask(
        actor(c),
        id.parse(c.req.param("taskId")),
      ),
    }),
  );
  app.post("/:botId/tasks/:taskId/confirm", async (c) =>
    c.json({
      result: await options.broker.confirmPanelTask(
        actor(c),
        id.parse(c.req.param("taskId")),
      ),
    }),
  );
  app.post("/:botId/tasks/:taskId/cancel", async (c) =>
    c.json({
      result: await options.broker.cancelPanelTask(
        actor(c),
        id.parse(c.req.param("taskId")),
      ),
    }),
  );
  return app;
}
