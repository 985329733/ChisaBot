import { createFileRoute, redirect } from "@tanstack/react-router";

/** 旧地址：设置 → 图片生成（§56）已并入 设置 → 模型 的「生图模型」（DESIGN.md §59）。 */
export const Route = createFileRoute("/_authed/admin/images")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/models", hash: "image-model", replace: true });
  },
});
