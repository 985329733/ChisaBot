import { IconSearch, IconX } from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import {
  onSidebarSearchFocusRequest,
  setSidebarSearch,
  takeSidebarSearchFocus,
  useSidebarSearch,
} from "@/lib/sidebar-search";

const MAC = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

/**
 * 左栏卡片顶部的「搜索会话」（DESIGN-v4）：输入框和结果在同一张卡片上。
 * 36px 高，宽度跟着卡片，聚焦只加深边框 + 轻阴影，不改变尺寸、不推动任何元素。
 * Ctrl K 由外壳统一处理（展开左栏 → 聚焦这里）。Esc 清空并离开。
 */
export function SidebarSearchField() {
  const search = useSidebarSearch();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = () => {
      if (!takeSidebarSearchFocus()) return;
      // 左栏刚展开时输入框还在过渡里，下一帧再聚焦，光标不会落空。
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.select();
      });
    };
    focus();
    return onSidebarSearchFocusRequest(focus);
  }, []);
  return (
    <label className="side-search">
      <IconSearch aria-hidden className="side-search-ico" />
      <input
        aria-label={"搜索会话"}
        className="side-search-input"
        onChange={(event) => setSidebarSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setSidebarSearch("");
            event.currentTarget.blur();
          }
        }}
        placeholder={"搜索会话"}
        ref={input}
        value={search}
      />
      {search ? (
        <button aria-label={"清除搜索"} className="side-search-clear" onClick={() => setSidebarSearch("")} type="button">
          <IconX className="size-3.5" />
        </button>
      ) : (
        <kbd aria-hidden className="side-search-kbd">
          {MAC ? "⌘K" : "Ctrl K"}
        </kbd>
      )}
    </label>
  );
}
