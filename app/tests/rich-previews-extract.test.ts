import { describe, expect, test } from "bun:test";
import {
  extensionOf,
  extractRichContent,
  formatBytes,
  MAX_LINK_CARDS,
  normalizeImageSrc,
  trimUrl,
} from "../src/lib/rich-previews/extract";

describe("聊天富预览：从文字里找链接和图片", () => {
  test("裸网址，去掉中英文结尾标点", () => {
    expect(
      extractRichContent(
        "看这个 https://example.com/a。还有 https://example.org/b, 好",
      ).links,
    ).toEqual(["https://example.com/a", "https://example.org/b"]);
    expect(extractRichContent("（来源：https://news.qq.com/x）").links).toEqual(
      ["https://news.qq.com/x"],
    );
    expect(extractRichContent("链接：https://a.cn/p?x=1&y=2！").links).toEqual([
      "https://a.cn/p?x=1&y=2",
    ]);
  });

  test("网址里成对的括号保留，多出来的右括号去掉", () => {
    expect(trimUrl("https://en.wikipedia.org/wiki/Foo_(bar)")).toBe(
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    );
    expect(trimUrl("https://en.wikipedia.org/wiki/Foo_(bar))")).toBe(
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    );
    expect(extractRichContent("(see https://example.com/x)").links).toEqual([
      "https://example.com/x",
    ]);
  });

  test("Markdown 链接和自动链接，按出现顺序去重", () => {
    const text =
      '先看 [文档](https://docs.example.com/guide "标题")，再看 <https://example.com>，又是 https://docs.example.com/guide#part2';
    expect(extractRichContent(text).links).toEqual([
      "https://docs.example.com/guide",
      "https://example.com/",
    ]);
  });

  test("最多 3 张链接卡", () => {
    const text = Array.from(
      { length: 6 },
      (_, i) => `https://site${i}.com/`,
    ).join(" ");
    expect(extractRichContent(text).links).toHaveLength(MAX_LINK_CARDS);
  });

  test("代码里的网址不算", () => {
    const text =
      "运行 `curl https://api.example.com/x`\n```\nfetch('https://internal.example.com')\n```\n结果见 https://ok.example.com";
    expect(extractRichContent(text).links).toEqual(["https://ok.example.com/"]);
  });

  test("Markdown 图片单独拿出来，不再当链接", () => {
    const text =
      "![图一](https://img.example.com/a.png) ![](/api/chat-shots/abc) [原图](https://img.example.com/a.png)";
    const out = extractRichContent(text);
    expect(out.images).toEqual([
      { src: "https://img.example.com/a.png", alt: "图一" },
      { src: "/api/chat-shots/abc", alt: "" },
    ]);
    expect(out.links).toEqual([]);
  });

  test("不认非 http(s) 和带账号密码的网址、没有点的主机名", () => {
    expect(
      extractRichContent(
        "javascript:alert(1) ftp://x.com/ https://user:pw@example.com/ http://intranet/",
      ).links,
    ).toEqual([]);
    expect(normalizeImageSrc("javascript:alert(1)")).toBeNull();
    expect(normalizeImageSrc("//evil.com/a.png")).toBeNull();
    expect(normalizeImageSrc("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
    expect(normalizeImageSrc("data:image/png;base64,iVBORw0KGgo=")).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
  });

  test("中文域名、长路径", () => {
    expect(
      extractRichContent("打开 https://例子.中国/路径 看看").links,
    ).toEqual(["https://xn--fsqu00a.xn--fiqs8s/%E8%B7%AF%E5%BE%84"]);
  });

  test("文件大小和扩展名", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(undefined)).toBe("");
    expect(extensionOf("报告.PDF")).toBe("pdf");
    expect(extensionOf("README")).toBe("");
  });
});
