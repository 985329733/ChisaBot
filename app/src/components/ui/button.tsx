import type { ReactNode } from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import {
  type AsyncState,
  type Feedback,
  type FeedbackLabels,
  type MutationLike,
  resolveFeedback,
  useMutationFeedback,
} from "@/components/ui/async-action";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,translate,opacity] duration-150 ease-out outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  render,
  /*
   * DIVERGES FROM UPSTREAM SHADCN. Base UI defaults `nativeButton` to `true`, which is right only
   * while the element really is a `<button>`. Six call sites here draw a router `Link` through
   * `render` instead — "New skill", "New agent", the sidebar's new-channel control, the two
   * empty-state returns, and `PageShell`'s back button, which is five routes in every state each of
   * them has — and every one of them warned at render that it had been told to expect a native
   * button and found an anchor. It was not only noise: Base UI was putting `type="button"` on an
   * anchor, which means nothing there, and withholding the `role="button"` and Space-to-activate
   * handling a non-button needs in order to behave like one.
   *
   * Replacing the element is exactly the case where the default is wrong, so the default follows
   * `render`, once here rather than at every call site. Passing `render` is not proof the result is
   * a non-button, only that we can no longer assume it is one, so a call site drawing a real
   * `<button>` through `render` passes `nativeButton` back explicitly — `combobox.tsx` is the one
   * that does.
   */
  nativeButton = render === undefined,
  /** Shorthand for `state="pending"` — kept for call sites that only know "busy or not". */
  loading = false,
  /**
   * DESIGN.md §2 state machine: idle → pending → success / error. Drive it with
   * `useMutationFeedback(mutation)` or `useAsyncAction(fn).state`.
   */
  state,
  /**
   * Status copy (a preset like "save" or `{ pending, success, error }`). With it the button
   * cross-fades between its idle children and "保存中… / 已保存 / 保存失败", sized to the widest so
   * nothing around it moves. Without it, non-idle states only swap the glyph in front of children.
   */
  feedback,
  /**
   * A TanStack mutation to follow instead of passing `state`: the button runs the state machine off
   * its status. `mutationWhen` narrows a mutation shared by several rows to this one.
   */
  mutation,
  mutationWhen = true,
  disabled,
  children,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean;
    state?: AsyncState;
    feedback?: Feedback;
    mutation?: MutationLike;
    mutationWhen?: boolean;
  }) {
  const followed = useMutationFeedback(mutation ?? IDLE_MUTATION, mutation !== undefined && mutationWhen);
  const active: AsyncState =
    state && state !== "idle"
      ? state
      : followed !== "idle"
        ? followed
        : loading
          ? "pending"
          : "idle";
  const labels = resolveFeedback(feedback);
  const iconOnly = typeof size === "string" && size.startsWith("icon");
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant ?? "default"}
      data-btn-state={active}
      aria-busy={active === "pending" || undefined}
      data-loading={active === "pending" ? "true" : undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || active === "pending"}
      nativeButton={nativeButton}
      render={render}
      {...props}
    >
      <AsyncContent
        iconOnly={iconOnly}
        labels={labels}
        stacked={Boolean(labels) || (iconOnly && (state !== undefined || mutation !== undefined))}
        state={active}
      >
        {children}
      </AsyncContent>
    </ButtonPrimitive>
  );
}

/**
 * The inside of an async button, for the rare control that cannot be `Button` (a glass pill with
 * its own look): put `data-btn-state={state}` on the element and this inside it.
 */
export function AsyncContent({
  state,
  labels,
  stacked = true,
  iconOnly = false,
  children,
}: {
  state: AsyncState;
  labels: FeedbackLabels | null;
  stacked?: boolean;
  iconOnly?: boolean;
  children?: ReactNode;
}) {
  if (!stacked) {
    return (
      <>
        {state !== "idle" ? <StatusGlyph /> : null}
        {children}
      </>
    );
  }
  return (
    <span className="btn-stack" data-state={state}>
      <span aria-hidden={state !== "idle" || undefined} className="btn-face" data-face="idle">
        {children}
      </span>
      <span aria-hidden={state === "idle" || undefined} className="btn-face" data-face="status">
        <StatusGlyph />
        {labels && !iconOnly ? (
          <span className="btn-labels">
            <span data-for="pending">{labels.pending}</span>
            <span data-for="success">{labels.success}</span>
            <span data-for="error">{labels.error}</span>
          </span>
        ) : null}
      </span>
      {labels && state !== "idle" ? (
        <span className="sr-only" role="status">
          {labels[state]}
        </span>
      ) : null}
    </span>
  );
}

const IDLE_MUTATION: MutationLike = { status: "idle", submittedAt: 0 };

/**
 * One SVG for every non-idle state so pending → success is a morph, not a swap: the spinning arc
 * closes into a full ring and fades while the check (or ✕) draws itself. Colour and motion live in
 * styles.css under `.btn-glyph`, keyed off the button's `data-btn-state`.
 */
export function StatusGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="btn-glyph"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2.4}
      viewBox="0 0 24 24"
    >
      <circle className="btn-glyph-ring" cx="12" cy="12" pathLength={100} r="9" />
      <path className="btn-glyph-check" d="M7.5 12.4l3.1 3.1 6-6.6" pathLength={100} />
      <path className="btn-glyph-x" d="M9 9l6 6M15 9l-6 6" pathLength={100} />
    </svg>
  );
}

export { Button, buttonVariants };
