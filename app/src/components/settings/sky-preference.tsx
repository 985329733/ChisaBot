import { useEffect } from "react";
import { PageRows } from "@/components/layout/page-shell";
import {
  setSkyEnabled,
  setSkyPreview,
  useSkyState,
} from "@/components/sky-background";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  currentMinuteOfDay,
  formatMinuteOfDay,
  skyPhaseName,
} from "@/lib/sky";

/** 「背景随时间变化」 toggle plus a 预览时间 slider that previews any hour without saving it. */
export function SkyPreference() {
  const { enabled, preview } = useSkyState();

  // Leaving the settings screen drops the preview; the sky goes back to the clock.
  useEffect(() => () => setSkyPreview(null), []);

  const shown = preview ?? Math.floor(currentMinuteOfDay());

  return (
    <PageRows>
      <Item size="sm">
        <ItemContent>
          <ItemTitle>{"背景随时间变化"}</ItemTitle>
          <ItemDescription>
            {
              "天空颜色跟随本机时间平滑变化：黎明、白天、傍晚、夜晚。关闭后使用固定的蓝天。"
            }
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Switch
            aria-label={"背景随时间变化"}
            checked={enabled}
            onCheckedChange={(checked) => {
              setSkyEnabled(checked);
              if (!checked) setSkyPreview(null);
            }}
          />
        </ItemActions>
      </Item>
      <div className="sky-preview-row" data-open={enabled ? "true" : "false"}>
        <div className="sky-preview-inner">
          <Separator />
          <Item size="sm">
            <ItemContent>
              <ItemTitle>{"预览时间"}</ItemTitle>
              <ItemDescription>
                {preview === null
                  ? "拖动预览任意时刻，不会保存。"
                  : "预览中，离开此页后恢复。"}
              </ItemDescription>
            </ItemContent>
            <ItemActions className="sky-preview-actions">
              <span className="sky-preview-time" aria-live="polite">
                {`${formatMinuteOfDay(shown)} · ${skyPhaseName(shown)}`}
              </span>
              <input
                aria-label={"预览时间"}
                className="sky-slider"
                disabled={!enabled}
                max={1439}
                min={0}
                onChange={(event) =>
                  setSkyPreview(Number(event.currentTarget.value))
                }
                step={15}
                type="range"
                value={Math.round(shown)}
              />
              <Button
                disabled={!enabled || preview === null}
                onClick={() => setSkyPreview(null)}
                size="sm"
                variant="ghost"
              >
                {"现在"}
              </Button>
            </ItemActions>
          </Item>
        </div>
      </div>
    </PageRows>
  );
}
