import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import {
  PageRows,
  PageSection,
  PageShell,
} from "@/components/layout/page-shell";
import { MessageListPreference } from "@/components/settings/message-list-preference";
import { SkyPreference } from "@/components/settings/sky-preference";
import { StandingInstructions } from "@/components/settings/standing-instructions";
import { useTheme } from "@/components/theme-provider";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { formatHotkey, HOTKEYS, SHELL_HOTKEYS } from "@/lib/hotkeys/hotkeys";

const ALL_HOTKEYS = [...HOTKEYS, ...SHELL_HOTKEYS];

export const Route = createFileRoute("/_authed/settings/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { dark, setDark } = useTheme();

  /*
   * The measurements that used to be written out here now live in `PageShell`, which Skills, Admin
   * and this screen all render through. The reason they match is no longer that somebody remembered
   * to copy them.
   *
   * Connected accounts used to be a section below. It is its own screen now: a connector can need
   * more from a person than one switch, and a section cannot grow a page's worth of that.
   */
  return (
    <PageShell
      description={
        "ChisaBot 在你这里的显示和行为。消息列表偏好与账号同步，外观保存在此浏览器。"
      }
      title={"通用"}
    >
      <PageSection title={"外观"}>
        <PageRows>
          <Item size="sm">
            <ItemContent>
              <ItemTitle>{"主题"}</ItemTitle>
              <ItemDescription>{"浅色或深色外观，保存在此浏览器。"}</ItemDescription>
            </ItemContent>
            <ItemActions>
              {/* 分段控件 (DESIGN.md §11). 跟随系统 is not offered: the theme is stored as a boolean. */}
              <div aria-label={"主题"} className="sg-segmented" role="radiogroup">
                {[
                  { on: false, label: "浅色", Icon: IconSun },
                  { on: true, label: "深色", Icon: IconMoon },
                ].map(({ on, label, Icon }) => (
                  <button
                    aria-checked={dark === on}
                    className="sg-segmented-item"
                    key={label}
                    onClick={() => setDark(on)}
                    role="radio"
                    type="button"
                  >
                    <Icon className="size-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </ItemActions>
          </Item>
          <Separator />
          <SkyPreference bare />
        </PageRows>
      </PageSection>
      <PageSection title={"消息列表"}>
        <MessageListPreference />
      </PageSection>
      {/*
       * Above the shortcuts and below the appearance preferences, because it is the only thing on this
       * screen that changes what a coworker says rather than what this browser looks like.
       */}
      <StandingInstructions />
      {/*
       * Drawn from the same registry the listeners match against, so this list is what the keys
       * actually do rather than what somebody remembered they did. Read-only on purpose: these
       * are not rebindable, and a row with nothing to click says so by having nothing to click.
       */}
      <PageSection title={"键盘快捷键"}>
        <PageRows>
          {ALL_HOTKEYS.map((hotkey, index) => (
            <React.Fragment key={hotkey.id}>
              <Item size="sm">
                <ItemContent>
                  <ItemTitle>{hotkey.label}</ItemTitle>
                  <ItemDescription>{hotkey.description}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <span className="flex gap-1">
                    {formatHotkey(hotkey.combo).map((part) => (
                      <kbd
                        className="rounded-md border bg-muted px-1.5 py-0.5 font-sans text-xs text-muted-foreground"
                        key={part}
                      >
                        {part}
                      </kbd>
                    ))}
                  </span>
                </ItemActions>
              </Item>
              {index !== ALL_HOTKEYS.length - 1 && <Separator />}
            </React.Fragment>
          ))}
        </PageRows>
      </PageSection>
    </PageShell>
  );
}
