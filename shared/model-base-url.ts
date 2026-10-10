/** Canonical API prefixes for validated OpenAI-compatible and Anthropic base URLs. */
export function normalizeModelBaseUrl(
  provider: "openai" | "anthropic",
  value: string,
): string {
  const address = new URL(value.trim());
  let path = address.pathname.replace(/\/+$/u, "") || "/v1";
  // Step Plan's official SDK base omits /v1. The AI SDK appends only the operation name,
  // so convert this documented prefix without guessing paths on arbitrary gateways.
  if (
    (provider === "openai" || provider === "anthropic") &&
    (address.hostname === "api.stepfun.com" ||
      address.hostname === "api.stepfun.ai") &&
    path === "/step_plan"
  ) {
    path = "/step_plan/v1";
  }
  return `${address.origin}${path}`;
}
