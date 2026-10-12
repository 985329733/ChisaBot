import { useEffect, useState } from "react";
import { type ComputerStatus, currentComputerStatus, onComputerStatus } from "@/lib/copilot/computer-activity";

/** 这个机器人计算机的当前状态行；结束后保留 {@link LINGER_MS}，然后淡出为 null。 */
const LINGER_MS = 6_000;

export function useComputerStatus(botId: string | undefined): ComputerStatus | null {
  const [value, setValue] = useState<ComputerStatus | null>(() => {
    const s = currentComputerStatus();
    return s && s.botId === botId && (s.pending || Date.now() - s.at < LINGER_MS) ? s : null;
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onComputerStatus((s) => {
      if (!s || s.botId !== botId) return;
      clearTimeout(timer);
      setValue(s);
      if (!s.pending) timer = setTimeout(() => setValue(null), LINGER_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [botId]);
  return value;
}
