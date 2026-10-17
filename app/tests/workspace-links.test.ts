import { describe, expect, test } from "bun:test";
import { workspaceLinks, workspacePathOf } from "../src/lib/chat/workspace-links";

const O = "https://ayase.cn:8443";
describe("workspace file links (§101)", () => {
  test("recognises workspace file targets", () => {
    expect(workspacePathOf("primes_1_to_1000000.py")).toBe("primes_1_to_1000000.py");
    expect(workspacePathOf("notes/todo.md")).toBe("notes/todo.md");
    expect(workspacePathOf("./out/a.csv")).toBe("out/a.csv");
    expect(workspacePathOf("/workspace/report.pdf")).toBe("report.pdf");
    expect(workspacePathOf("file:///workspace/a%20b.txt")).toBe("a b.txt");
    expect(workspacePathOf("sandbox:/workspace/x.png")).toBe("x.png");
    expect(workspacePathOf("https://workspace.local/page.html")).toBe("page.html");
  });
  test("leaves everything else alone", () => {
    for (const t of ["https://github.com/a", "mailto:a@b.c", "#top", "data:text/plain,x", "../etc/passwd", "看这里", "//cdn.x/y.js", "/api/chat-files/861666c0-849d-4d24-873a-f5655e2a0451", "/p/weekend/", "/downloads/pc/a.exe"])
      expect(workspacePathOf(t)).toBeNull();
  });
  test("rewrites links outside code only", () => {
    const md = "代码已保存为 [primes.py](primes.py)。来源 [GitHub](https://github.com)\n```\n[x](x.py)\n```";
    expect(workspaceLinks(md, "agent_1", O)).toBe(
      `代码已保存为 [primes.py](${O}/api/computers/agent_1/files/download?path=primes.py)。来源 [GitHub](https://github.com)\n\`\`\`\n[x](x.py)\n\`\`\``,
    );
    expect(workspaceLinks(md, undefined, O)).toBe(md);
  });
  test("bare workspace.local URLs become download links (§101.13)", () => {
    const md = "你可以下载工作区里的文件：https://workspace.local/primes.py 和 https://workspace.local/primes_result.txt。\n<https://workspace.local/out/a.csv>";
    const d = (p: string) => `${O}/api/computers/agent_1/files/download?path=${encodeURIComponent(p)}`;
    expect(workspaceLinks(md, "agent_1", O)).toBe(
      `你可以下载工作区里的文件：[primes.py](${d("primes.py")}) 和 [primes_result.txt](${d("primes_result.txt")})。\n[out/a.csv](${d("out/a.csv")})`,
    );
    // 已是 Markdown 链接的只改一次；行内代码和代码块里不动
    expect(workspaceLinks("[a](https://workspace.local/a.py) `https://workspace.local/b.py`", "agent_1", O)).toBe(`[a](${d("a.py")}) \`https://workspace.local/b.py\``);
    expect(workspaceLinks("```\nhttps://workspace.local/c.py\n```", "agent_1", O)).toBe("```\nhttps://workspace.local/c.py\n```");
    expect(workspaceLinks("看 https://workspace.local/c.py.", "agent_1", O)).toBe(`看 [c.py](${d("c.py")}).`);
  });
});
