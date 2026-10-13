/*
 * 构建时替换 rehype-katex（DESIGN.md §41.4）。
 *
 * 只有 CopilotKit 自带的旧版 streamdown（@copilotkit/react-core/node_modules/streamdown）引用它，
 * 它把 katex（约 470KB 未压缩）整个带进首屏包。ChisaBot 的回复用的是自己的 streamdown 2.x
 * （components/chat/smooth-markdown.tsx，不带数学插件），所以聊天里的公式显示本来就不经过它；
 * 替换后 CopilotKit 默认渲染器里的 $…$ 原样显示为文字。
 */
export default function rehypeKatex() {
  return () => {};
}
