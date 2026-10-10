// This is a public browser link. API credentials belong only in the server's model settings.
export const MAGPIE_ADMIN_URL: string | undefined = (() => {
  const configured = import.meta.env.VITE_MAGPIE_MANAGEMENT_URL?.trim();
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
})();
