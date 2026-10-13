import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { browserModeFromEnv, type BrowserMode } from "./browser-mode";

/** Whether an `Xvfb` binary is on PATH (the image installs it at /usr/bin/Xvfb). */
export function xvfbOnPath(env: Record<string, string | undefined>): boolean {
  const dirs = (env.PATH || "/usr/local/bin:/usr/bin:/bin").split(delimiter);
  return dirs.some((dir) => dir && existsSync(join(dir, "Xvfb")));
}

export type BrowserRuntime = {
  backend: "managed" | "local-chrome";
  channel: "chromium" | "chrome";
  mode: BrowserMode;
  useVirtualDisplay: boolean;
  hostname?: "127.0.0.1";
  allowExec: boolean;
};

/** The same launch decision is used by profiles and the computer HTTP process. */
export function browserRuntimeFromEnv(
  env: Record<string, string | undefined>,
  platform: string = process.platform,
  hasXvfb: boolean = platform === "linux" && xvfbOnPath(env),
): BrowserRuntime {
  const backend = env.COMPUTER_BROWSER_BACKEND?.trim() || "managed";
  if (backend !== "managed" && backend !== "local-chrome") {
    throw new Error(
      "COMPUTER_BROWSER_BACKEND must be managed or local-chrome.",
    );
  }
  const local = backend === "local-chrome";
  /*
   * 托管浏览器在 Linux 上、装了 Xvfb 时默认「有界面」跑在虚拟显示器里，而不是 headless。
   *
   * 原因是实测出来的（2026-10-13，FRA 同一个 IP、同一个镜像）：headless Chromium 打开 x.ai /
   * accounts.x.ai（grok.com 登录页）直接被 Cloudflare 封成「Sorry, you have been blocked」，
   * chatgpt.com 卡在「Just a moment...」；同样的浏览器换成 Xvfb 里的有界面模式，三个站都正常打开。
   * headless 的破绽不止 UA 里的 `HeadlessChrome`（只改 UA 时 x.ai 好了，accounts.x.ai 仍被封），
   * 还有插件列表为空、语言列表等一串检测器会交叉比对的特征，逐个伪装不如直接跑真的有界面浏览器。
   * 没有 Xvfb（比如自己 `bun run` 的开发机）时保持原来的 headless；运维也可以用
   * COMPUTER_BROWSER_MODE=headless 显式改回去。
   */
  const mode = browserModeFromEnv(
    env.COMPUTER_BROWSER_MODE?.trim() ||
      (local || hasXvfb ? "headed" : "headless"),
  );
  if (local && mode !== "headed") {
    throw new Error(
      "COMPUTER_BROWSER_BACKEND=local-chrome requires COMPUTER_BROWSER_MODE=headed.",
    );
  }
  return {
    backend,
    channel: local ? "chrome" : "chromium",
    mode,
    useVirtualDisplay: platform === "linux" && mode === "headed",
    ...(local ? { hostname: "127.0.0.1" as const } : {}),
    allowExec: !local,
  };
}
