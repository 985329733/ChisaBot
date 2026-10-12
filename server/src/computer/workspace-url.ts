/**
 * 机器人自己写的网页怎么在它的浏览器里打开。
 *
 * 计算机（agent-computer）把工作区挂在一个虚拟网址上：`https://workspace.local/<路径>`，请求在浏览器
 * 里就被拦下、从工作区读文件返回，从不出网（见 agent-computer/src/workspace-origin.ts）。模型很自然会
 * 写 `file:///workspace/page.html`，而 file 地址会被导航检查拒绝，所以在进网关之前把指向工作区的
 * file 地址换成虚拟网址；其他地址原样返回。和 agent-computer 里的同名函数保持一致。
 */
export const WORKSPACE_ORIGIN = "https://workspace.local";

export function workspaceUrlFor(input: string): string {
  const text = input.trim();
  if (!/^file:/i.test(text)) return input;
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return input;
  }
  let path: string;
  try {
    path = decodeURIComponent(
      `${parsed.hostname ? `/${parsed.hostname}` : ""}${parsed.pathname}`,
    );
  } catch {
    return input;
  }
  const match = /^\/+workspace(?:\/+(.*))?$/i.exec(path);
  if (!match) return input;
  const rest = (match[1] ?? "")
    .split("/")
    .filter((part) => part !== "")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${WORKSPACE_ORIGIN}/${rest}${parsed.search}${parsed.hash}`;
}
