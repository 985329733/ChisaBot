import { RouteSkeleton } from "@/components/startup-status";
import { IconCode, IconTag } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ComponentPreview } from "@/components/component-preview";
import {
  PageRows,
  PageSection,
  PageShell,
} from "@/components/layout/page-shell";
import { SettingsItemBackground } from "@/components/settings/background";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { componentListQueryOptions } from "@/lib/components/queries";

/** The same way back from every state this route can be in. */
const BACK = {
  label: "组件库",
  linkProps: { to: "/settings/components-gallery" },
} as const;

/**
 * One component, drawn as large as this column allows, and nothing to change.
 *
 * Deliberately not the Admin detail page with its controls hidden. That page is built out of four
 * mutations and three kinds of row; threading a read-only flag through all of it would leave every
 * row carrying a branch for a case it mostly does not have.
 */
export const Route = createFileRoute(
  "/_authed/settings/components-gallery/$name",
)({
  component: RouteComponent,
});

/** A read-only fact: the label on the left, the value against the right. */
function FactRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <Item size="sm">
      <ItemMedia variant="icon">{icon}</ItemMedia>
      <ItemContent>
        <ItemTitle>{label}</ItemTitle>
      </ItemContent>
      <ItemActions className="text-muted-foreground text-sm">
        {children}
      </ItemActions>
    </Item>
  );
}

function RouteComponent() {
  const { name } = Route.useParams();
  const components = useQuery(componentListQueryOptions());

  if (components.isPending) return <RouteSkeleton />;

  if (components.error) {
    return (
      <PageShell backButton={BACK} title={"组件库"}>
        <p className="mt-8 text-destructive text-sm" role="alert">
          {"无法加载组件。"}
        </p>
      </PageShell>
    );
  }

  /*
   * Unpublished is treated as absent rather than as a component with a notice on it. Nothing can
   * draw one, so from here there is no difference between not published and not there.
   */
  const component = components.data?.find(
    (entry) => entry.name === name && entry.published,
  );

  if (!component) {
    return (
      <PageShell
        backButton={BACK}
        description={"此处没有匹配该名称的"}
        title={"不存在此组件"}
      >
        <Empty className="mt-12 min-h-[30dvh] border border-dashed">
          <EmptyHeader>
            <EmptyTitle>{name}</EmptyTitle>
            <EmptyDescription className="text-pretty">
              {"它可能已被撤回，或者此部署可能不再包含它。"}
            </EmptyDescription>
          </EmptyHeader>
          <Button
            render={<Link to="/settings/components-gallery" />}
            size="sm"
            variant="outline"
          >
            {"返回画廊"}
          </Button>
        </Empty>
      </PageShell>
    );
  }

  return (
    <PageShell
      backButton={BACK}
      description={component.publishedDescription ?? undefined}
      title={component.title}
    >
      <div className="relative mt-8 aspect-[2/1] overflow-hidden rounded-lg border border-border bg-card">
        <div className="absolute inset-0">
          <SettingsItemBackground className="h-full w-full" />
        </div>
        <div className="absolute inset-0 z-10">
          <ComponentPreview kind={component.kind} name={component.name} />
        </div>
      </div>

      <PageSection title={"详情"}>
        <PageRows>
          <FactRow icon={<IconTag />} label={"类型"}>
            {component.kind}
          </FactRow>
          <Separator />
          <FactRow icon={<IconCode />} label={"称为"}>
            <code className="rounded bg-foreground/5 px-1.5 py-0.5 text-xs">
              {component.name}
            </code>
          </FactRow>
        </PageRows>
      </PageSection>
    </PageShell>
  );
}
