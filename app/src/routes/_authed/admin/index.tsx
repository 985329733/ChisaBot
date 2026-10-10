import {
  IconBrain,
  IconBuildingBank,
  IconChevronRight,
  IconCode,
  IconDeviceDesktop,
  IconExternalLink,
  IconFileText,
  IconKey,
  IconLayoutGrid,
  IconListDetails,
  IconNetwork,
  IconPuzzle,
  IconShieldCheck,
  IconUsers,
} from "@tabler/icons-react";
import {
  createFileRoute,
  Link,
  type LinkOptions,
} from "@tanstack/react-router";
import {
  PageShell,
} from "@/components/layout/page-shell";
import { StaggerItem } from "@/components/layout/stagger";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { MAGPIE_ADMIN_URL } from "@/lib/magpie";

export const Route = createFileRoute("/_authed/admin/")({
  component: RouteComponent,
});

/**
 * Grouped by what the decision is about rather than by how the code is organised.
 *
 * "What Bots can reach" is the group an administrator arrives worrying about, so it goes first.
 * Everything in it either grants a capability or fences one in.
 */
const SECTIONS: {
  title: string;
  description: string;
  items: ({
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    title: string;
  } & (
    | { linkOptions: LinkOptions; href?: never }
    | { href: string; linkOptions?: never }
  ))[];
}[] = [
  {
    title: "机器人可以访问什么",
    description: "机器人可以在此应用外部触及的一切，以及对其的限制。",
    items: [
      {
        title: "模型设置",
        description: "配置聊天模型、接口地址和 API Key，保存后即时生效。",
        icon: IconBrain,
        linkOptions: { to: "/admin/models" },
      },
      ...(MAGPIE_ADMIN_URL
        ? [{
            title: "Magpie 模型管理",
            description: "管理模型供应商、模型与网关，在新标签页打开。",
            icon: IconNetwork,
            href: MAGPIE_ADMIN_URL,
          }]
        : []),
      {
        title: "凭据",
        description: "为该部署持有的密钥和令牌。",
        icon: IconKey,
        linkOptions: { to: "/admin/credentials" },
      },
      {
        title: "权限规则",
        description: "决定机器人永远不能做什么的规则",
        icon: IconShieldCheck,
        linkOptions: { to: "/admin/boundaries" },
      },
      {
        title: "计算机",
        description: "机器人运行其工具的机器。",
        icon: IconDeviceDesktop,
        linkOptions: { to: "/admin/computers" },
      },
    ],
  },
  {
    title: "机器人可以做什么",
    description: "跨机器人可用的能力和界面元素。",
    items: [
      {
        title: "插件",
        description: "此部署可以访问的服务，以及机器人可以访问的服务。",
        icon: IconPuzzle,
        linkOptions: { to: "/admin/plugins" },
      },
      {
        title: "技能",
        description: "命名指令，任何人可用斜杠调用。",
        icon: IconFileText,
        linkOptions: { to: "/admin/skills" },
      },
      {
        title: "自动学习",
        description: "从已完成的会话中学习并审查建议的技能。",
        icon: IconFileText,
        linkOptions: { to: "/admin/learning" },
      },
      {
        title: "UI 组件",
        description: "Bot可以在对话中绘制的自定义片段。",
        icon: IconLayoutGrid,
        linkOptions: { to: "/admin/components" },
      },
      {
        title: "游乐场",
        description: "编写组件并在输入时观看其渲染。",
        icon: IconCode,
        linkOptions: { to: "/admin/playground" },
      },
    ],
  },
  {
    title: "谁可以进入",
    description: "",
    items: [
      {
        title: "人员",
        description:
          "所有已签入、负责此部署的人员，以及已被移除访问权限的人员。",
        icon: IconUsers,
        linkOptions: { to: "/admin/people" },
      },
      {
        title: "企业控制",
        description:
          "按角色和组的能力，SSO必需，SCIM，网络策略，MCP和模型白名单，动作记录。",
        icon: IconShieldCheck,
        linkOptions: { to: "/admin/enterprise" },
      },
      {
        title: "身份提供者",
        description:
          "公司的自有 SAML 或 OpenID Connect 提供程序，按电子邮件域路由。",
        icon: IconBuildingBank,
        linkOptions: { to: "/admin/identity-providers" },
      },
    ],
  },
  {
    title: "发生了什么",
    description: "",
    items: [
      {
        title: "审计",
        description: "此部署中采取的每个操作，以及由谁采取。",
        icon: IconListDetails,
        linkOptions: { to: "/admin/audit" },
      },
    ],
  },
];

function RouteComponent() {
  return (
    <PageShell
      description={
        "适用于此部署中所有人的设置。此处的任何内容都会影响每个人和每个机器人，这与您的个人偏好不同。"
      }
      title={"部署概览"}
    >
      {/* Template E: the four questions as a 2-up grid of glass cards (DESIGN.md §12). */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {SECTIONS.map((section) => (
          <section className="page-rows admin-group" key={section.title}>
            <div className="sg-card-h pb-1">
              <div className="min-w-0 flex-1">
                <h3>{section.title}</h3>
                {section.description ? <p>{section.description}</p> : null}
              </div>
            </div>
            {section.items.map((item, index) => (
              <StaggerItem index={index} key={item.title}>
                {/* The whole row is the link: every row here goes exactly one place. */}
                <Item
                  render={(props) => item.href ? (
                    <a {...props} href={item.href} target="_blank" rel="noopener noreferrer" />
                  ) : (
                    <Link {...item.linkOptions} {...props} />
                  )}
                  size="sm"
                >
                  <ItemMedia variant="icon">
                    <item.icon className="size-[18px]" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{item.title}</ItemTitle>
                    <ItemDescription>{item.description}</ItemDescription>
                  </ItemContent>
                  {item.href ? (
                    <IconExternalLink className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <IconChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  )}
                </Item>
              </StaggerItem>
            ))}
          </section>
        ))}
      </div>
    </PageShell>
  );
}
