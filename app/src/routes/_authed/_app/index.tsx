import { createFileRoute } from "@tanstack/react-router";
import { LandingRedirect } from "@/components/agents/landing-redirect";

/**
 * No home page: opening the app is facing a Bot. `/` forwards to the last-used Bot's conversation
 * (else 主机器人, else the first Bot). Every `navigate({ to: "/" })` in the app — after deleting a
 * conversation, leaving settings, a 404 — therefore also lands in a chat.
 */
export const Route = createFileRoute("/_authed/_app/")({
  component: LandingRedirect,
});
