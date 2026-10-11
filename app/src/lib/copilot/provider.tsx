import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { deploymentCapabilitiesQueryOptions } from "@/lib/deployment/queries";
import { SignInTool } from "./sign-in-tool";
import { ActiveBotProvider } from "./active-bot";
import { BotTools } from "./bot-tools";
import { ComputerTools } from "./computer-tools";
import { EscalationTool } from "./escalation-tool";
import { GalleryTools } from "./gallery-tools";
import { HandoffTool } from "./handoff-tool";
import { RenderUiTool } from "./render-ui-tool";
import { SandboxedTools } from "./sandboxed-tools";
import { SkillTools } from "./skill-tools";

/**
 * The CopilotKit client, wrapped once for the whole authenticated app.
 *
 * `credentials: "include"` is the load-bearing part. OpenBot authenticates with a Better Auth
 * session cookie, and the runtime endpoint sits behind the same guard as every other API route, so
 * without it every run is rejected as anonymous while the rest of the app looks signed in.
 *
 * The URL is relative, like every other call in the app, so the Vite dev proxy and a single-origin
 * deployment both work without a build-time base URL to get wrong.
 *
 * There is no `publicApiKey`. The Intelligence key and licence token are deployment secrets held by
 * the server; a browser never sees them (see server/src/app.ts, where /api/capabilities projects the
 * runtime rather than returning it).
 */
export function CopilotProvider({ children }: { children: ReactNode }) {
  const { data: capabilities } = useQuery(deploymentCapabilitiesQueryOptions());

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      credentials="include"
      /*
       * 不传 `openGenerativeUI`：Open Generative UI（`generateSandboxedUi`，沙箱 iframe 自写 HTML）
       * 已停用。SDK 只要运行时声明了该能力或这里出现了这个属性就会把工具提供给 Bot；服务器已不再
       * 声明，这里也不再传，于是 json-render 的 `render_ui`（下面的 RenderUiTool）是唯一的生成式界面。
       */
    >
      {/* Computer tools target the Bot declared by the mounted surface. */}
      <ActiveBotProvider>
        <ComputerTools />
        {/*
          json-render 生成式界面（取代 A2UI）：`render_ui` 在服务器上执行并校验，这里只负责画。
          与服务器提供这个工具是同一个开关（/api/capabilities 的 generativeUi）。
        */}
        {capabilities?.generativeUi ? <RenderUiTool /> : null}
        {/* The private sign-in request: a card whose form posts to the server, never to the Bot. */}
        <SignInTool />
        {/*
          Draws a Bot bringing in another Bot. Registers no tool: `message_bot` runs on the server,
          where the grant and the caps are. A hop that happens off-screen is the thing to avoid.
        */}
        <HandoffTool />
        <EscalationTool />
        {/* Gallery tools are registered once; their handlers re-read the active Bot to avoid shadowing renderers. */}
        <GalleryTools />
        {/* Browser-authored components use the same component grants as the compiled gallery. */}
        <SandboxedTools />
        {/* Offered only on a Bot holding the skill-creator skill; see skill-tools.tsx. */}
        <SkillTools />
        {/*
          Making a coworker from a conversation. Registers nothing unless the declared Bot holds the
          `bot-creator` skill, so most runs are not offered these four tools at all.
        */}
        <BotTools />
        {children}
      </ActiveBotProvider>
    </CopilotKitProvider>
  );
}
