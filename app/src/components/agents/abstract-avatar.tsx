import { BotAvatar } from "@/components/agents/bot-avatar";

/**
 * 旧名字，留给现有调用处：现在就是共用的圆形 `BotAvatar`（DESIGN.md §81）。给了 `agentId` 就显示机器人自己的头像
 * （上传的图片 / 表情 / 首字），没有设置时是按 `seed` 生成的花纹。
 */
export function AbstractAvatar({
  name,
  seed,
  size = 40,
  agentId,
}: {
  name: string;
  seed: string;
  size?: number;
  agentId?: string;
}) {
  return <BotAvatar agentId={agentId} name={name} seed={seed} size={size} />;
}
