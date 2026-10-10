import {
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
  IconX,
} from "@tabler/icons-react";
import { useSyncExternalStore } from "react";

/**
 * A small glass toast stack. Module-level so any handler can say "已保存" without threading a
 * context through; `<Toaster />` is mounted once at the root.
 */
type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; text: string; leaving?: boolean };

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

function dismiss(id: number) {
  items = items.map((item) => (item.id === id ? { ...item, leaving: true } : item));
  emit();
  window.setTimeout(() => {
    items = items.filter((item) => item.id !== id);
    emit();
  }, 180);
}

function push(kind: ToastKind, text: string, duration = kind === "error" ? 5200 : 2600) {
  const id = nextId++;
  // Same sentence twice in a row is one toast, not a stack of identical ones.
  items = [...items.filter((item) => item.text !== text), { id, kind, text }].slice(-4);
  emit();
  window.setTimeout(() => dismiss(id), duration);
  return id;
}

export const toast = {
  success: (text: string) => push("success", text),
  error: (text: string) => push("error", text),
  info: (text: string) => push("info", text),
  dismiss,
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => items;

const ICONS = {
  success: IconCircleCheck,
  error: IconAlertTriangle,
  info: IconInfoCircle,
} as const;

export function Toaster() {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  return (
    <div aria-live="polite" className="glass-toaster" role="region" aria-label={"通知"}>
      {list.map((item) => {
        const Icon = ICONS[item.kind];
        return (
          <div
            className="glass-toast"
            data-kind={item.kind}
            data-leaving={item.leaving ? "true" : undefined}
            key={item.id}
            role={item.kind === "error" ? "alert" : "status"}
          >
            <Icon className="glass-toast-icon size-4 shrink-0" />
            <span className="min-w-0 flex-1">{item.text}</span>
            <button
              aria-label={"关闭通知"}
              className="glass-toast-close"
              onClick={() => dismiss(item.id)}
              type="button"
            >
              <IconX className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
