import { IconDeviceDesktopDown, IconDeviceMobileDown, IconPlus, IconShare2, IconX } from "@tabler/icons-react";
import { useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { isPhone, isStandalone } from "@/lib/device";
import { isIOSSafari, isNativeClient, promptInstall, useInstallState } from "@/lib/pwa";

/**
 * 「安装 ChisaBot 应用」（DESIGN.md §40.3）。
 *
 * 浏览器里打开网页版时，在顶栏下面居中出现一枚可关闭的玻璃胶囊（与「有新版本」同一种）：
 * - Chrome / Edge（安卓、Windows、macOS…）：浏览器说可以安装时出现，「安装」弹出浏览器自己的安装确认；
 * - iPhone / iPad 的 Safari：点开是一张小卡片，教「点分享 → 添加到主屏幕」；
 * - ChisaBot PC、安卓客户端、已经安装后打开（独立窗口）、引导页：都不出现。
 * 打开页面 8 秒后才出现，不在加载的第一秒打扰；关掉后 14 天内不再出现（localStorage）。
 * 「有新版本」提示在的时候让位（styles.css）。
 */
const KEY = "chisabot-install-hint";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;
const DELAY_MS = 8000;

function snoozed(): boolean {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return false;
    const { dismissedAt } = JSON.parse(raw) as { dismissedAt?: number };
    return typeof dismissedAt === "number" && Date.now() - dismissedAt < SNOOZE_MS;
  } catch {
    return false;
  }
}

function snooze() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ dismissedAt: Date.now() }));
  } catch {}
}

export function InstallHint() {
  const { canPrompt, installed } = useInstallState();
  const pathname = useLocation({ select: (location) => location.pathname });
  const [ready, setReady] = useState(false);
  const [closing, setClosing] = useState(false);
  const [gone, setGone] = useState(false);
  const [iosOpen, setIosOpen] = useState(false);
  const ios = typeof window !== "undefined" && isIOSSafari();

  const eligible =
    !gone && !installed && !isStandalone() && !isNativeClient() && (canPrompt || ios) && !pathname.startsWith("/onboarding");

  useEffect(() => {
    if (!eligible || ready) return;
    if (snoozed()) {
      setGone(true);
      return;
    }
    const timer = window.setTimeout(() => setReady(true), DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [eligible, ready]);

  if (!eligible || !ready) return null;

  const close = (remember: boolean) => {
    if (remember) snooze();
    setClosing(true);
    window.setTimeout(() => setGone(true), 160);
  };

  const install = async () => {
    if (ios) {
      setIosOpen((open) => !open);
      return;
    }
    const accepted = await promptInstall();
    close(!accepted);
  };

  const DeviceIcon = isPhone() ? IconDeviceMobileDown : IconDeviceDesktopDown;

  return (
    <div className="install-hint" data-state={closing ? "closed" : "open"} role="status" aria-live="polite">
      <div className="install-hint-row">
        <button className="install-hint-main" onClick={() => void install()} type="button" aria-expanded={ios ? iosOpen : undefined}>
          <img alt="" className="install-hint-logo" height={24} src="/pwa-any-192.png" width={24} />
          <span className="install-hint-t">{"安装 ChisaBot 应用"}</span>
          <span className="install-hint-go">
            <DeviceIcon aria-hidden className="size-4" />
            {ios ? "怎么装" : "安装"}
          </span>
        </button>
        <button aria-label={"不再提示安装"} className="install-hint-x" onClick={() => close(true)} type="button">
          <IconX className="size-4" />
        </button>
      </div>
      {ios && iosOpen ? (
        <ol className="install-hint-ios">
          <li>
            <span>{"点浏览器的"}</span>
            <span className="install-hint-key">
              <IconShare2 aria-hidden className="size-4" />
              {"分享"}
            </span>
            <span>{"按钮"}</span>
          </li>
          <li>
            <span>{"选择"}</span>
            <span className="install-hint-key">
              <IconPlus aria-hidden className="size-4" />
              {"添加到主屏幕"}
            </span>
          </li>
          <li>{"以后从主屏幕的 ChisaBot 图标打开，全屏、像应用一样使用。"}</li>
        </ol>
      ) : null}
    </div>
  );
}
