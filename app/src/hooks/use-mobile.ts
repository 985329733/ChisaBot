import * as React from "react";
import { isPhone, NARROW_QUERY } from "@/lib/device";

/**
 * 窄（竖屏）布局：手机永远是（横过来也是，DESIGN.md §40），其它设备看窗口是否 < 768px。
 * 首帧就给出正确值，左栏不会先画成宽窗口再收进抽屉。
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(() =>
    typeof window === "undefined" ? false : isPhone() || window.matchMedia(NARROW_QUERY).matches,
  );

  React.useEffect(() => {
    if (isPhone()) {
      setIsMobile(true);
      return;
    }
    const mql = window.matchMedia(NARROW_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
