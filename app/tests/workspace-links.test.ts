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
    for (const t of ["https://github.com/a", "mailto:a@b.c", "#top", "data:text/plain,x", "../etc/passwd", "看这里", "//cdn.x/y.js"])
      expect(workspacePathOf(t)).toBeNull();
  });
  test("rewrites links outside code only", () => {
    const md = "代码已保存为 [primes.py](primes.py)。来源 [GitHub](https://github.com)\n```\n[x](x.py)\n```";
    expect(workspaceLinks(md, "agent_1", O)).toBe(
      `代码已保存为 [primes.py](${O}/api/computers/agent_1/files/download?path=primes.py)。来源 [GitHub](https://github.com)\n\`\`\`\n[x](x.py)\n\`\`\``,
    );
    expect(workspaceLinks(md, undefined, O)).toBe(md);
  });
});
