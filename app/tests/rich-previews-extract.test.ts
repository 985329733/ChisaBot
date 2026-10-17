import { describe, expect, test } from "bun:test";
import {
  extensionOf,
  extractRichContent,
  formatBytes,
  looksLikePartialLinkLine,
  MAX_LINK_CARDS,
  normalizeImageSrc,
  parseLinkLine,
  splitLinkLines,
  trimUrl,
} from "../src/lib/rich-previews/extract";

describe("聊天富预览：从文字里找链接和图片", () => {
  const urls = (text: string) => extractRichContent(text).links.map((l) => l.url);

  test("单独一行的裸网址出卡，去掉中英文结尾标点", () => {
    expect(urls("看这个：\nhttps://example.com/a。\nhttps://example.org/b,\n好")).toEqual([
      "https://example.com/a",
      "https://example.org/b",
    ]);
    expect(urls("链接：\n  https://a.cn/p?x=1&y=2！  ")).toEqual(["https://a.cn/p?x=1&y=2"]);
  });

  test("workspace.local 不是网页，不出链接卡（§101.11）", () => {
    expect(urls("你可以从这里下载：\n[primes.py 下载](https://workspace.local/primes.py)")).toEqual([]);
    expect(urls("https://workspace.local/a.csv")).toEqual([]);
  });

  test("句子里的链接不出卡（DESIGN.md §48）", () => {
    expect(urls("看这个 https://example.com/a 还有 [文档](https://docs.example.com)")).toEqual([]);
    expect(urls("（来源：https://news.qq.com/x）")).toEqual([]);
    expect(urls("下载：https://a.cn/x")).toEqual([]);
    expect(urls("https://a.cn/x 是官网")).toEqual([]);
  });

  test("列表项和引用里的链接不出卡（多半是来源列表）", () => {
    expect(urls("- https://a.cn/1\n* [b](https://b.cn)\n1. https://c.cn\n> https://d.cn")).toEqual([]);
  });

  test("[标签](网址) 一行：标签上卡；标签就是网址 / 域名时不要", () => {
    const out = extractRichContent(
      "[下载 0.1.7](https://github.com/ChisaAlter/ChisaBot/releases/tag/v0.1.7)\n[github.com](https://github.com/x)\n[**打开控制台**](<https://console.example.com/a> \"标题\")",
    );
    expect(out.links).toEqual([
      { url: "https://github.com/ChisaAlter/ChisaBot/releases/tag/v0.1.7", label: "下载 0.1.7" },
      { url: "https://github.com/x" },
      { url: "https://console.example.com/a", label: "打开控制台" },
    ]);
  });

  test("<网址> 一行、外面包 ** 的一行也算；网址里成对的括号保留", () => {
    expect(urls("<https://example.com>\n**https://b.cn/y**\nhttps://en.wikipedia.org/wiki/Foo_(bar)")).toEqual([
      "https://example.com/",
      "https://b.cn/y",
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    ]);
    expect(trimUrl("https://en.wikipedia.org/wiki/Foo_(bar))")).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
  });

  test("去重（忽略 #）、最多 3 张", () => {
    expect(urls("https://docs.example.com/guide\nhttps://docs.example.com/guide#part2")).toEqual([
      "https://docs.example.com/guide",
    ]);
    const many = Array.from({ length: 6 }, (_, i) => `https://site${i}.com/`).join("\n");
    expect(extractRichContent(many).links).toHaveLength(MAX_LINK_CARDS);
  });

  test("代码里的网址不算", () => {
    const text = "运行：\n```\nhttps://internal.example.com\n```\n~~~\nhttps://x.example.com\n~~~\n`https://inline.example.com`\nhttps://ok.example.com";
    expect(urls(text)).toEqual(["https://ok.example.com/"]);
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

  test("单独一行的网址就是那张图时，只进图片、不出链接卡", () => {
    const out = extractRichContent("![a](https://i.example.com/a.png)\nhttps://i.example.com/a.png\nhttps://z.example.com");
    expect(out.links).toEqual([{ url: "https://z.example.com/" }]);
  });

  test("不认非 http(s) 和带账号密码的网址、没有点的主机名", () => {
    expect(
      extractRichContent(
        "javascript:alert(1)\nftp://x.com/\nhttps://user:pw@example.com/\nhttp://intranet/",
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
    expect(urls("打开：\nhttps://例子.中国/路径")).toEqual(["https://xn--fsqu00a.xn--fiqs8s/%E8%B7%AF%E5%BE%84"]);
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

describe("链接卡：正文拿掉出卡的行、流式时最后一行（DESIGN.md §48）", () => {
  test("出卡的行从正文里拿掉，句中链接和其余文字原样保留", () => {
    const text = "新版本好了：\n\n[下载 0.1.7](https://github.com/a/b/releases)\nhttps://ayase.cn/downloads/\n\n详见 [文档](https://docs.x.com)。";
    const out = splitLinkLines(text, { final: true });
    expect(out.links.map((l) => l.url)).toEqual(["https://github.com/a/b/releases", "https://ayase.cn/downloads/"]);
    expect(out.display).toBe("新版本好了：\n\n详见 [文档](https://docs.x.com)。");
    expect(out.pending).toBe(false);
  });

  test("没有出卡的行时正文一字不改", () => {
    const text = "普通回答\n\n- 一\n- 二\n";
    expect(splitLinkLines(text, { final: true }).display).toBe(text);
  });

  test("第 4 个及以后的链接行留在正文里", () => {
    const text = Array.from({ length: 4 }, (_, i) => `https://s${i}.com/`).join("\n");
    const out = splitLinkLines(text, { final: true });
    expect(out.links).toHaveLength(3);
    expect(out.display).toBe("https://s3.com/");
  });

  test("流式：最后一行半截网址先藏起来、放骨架，不拿去取预览", () => {
    const out = splitLinkLines("看这个：\nhttps://github.com/Chi", { final: false });
    expect(out.links).toEqual([]);
    expect(out.pending).toBe(true);
    expect(out.display).toBe("看这个：");
    // 写完（后面来了换行，或文字停下）就出卡。
    expect(splitLinkLines("看这个：\nhttps://github.com/ChisaAlter\n", { final: false }).links).toEqual([
      { url: "https://github.com/ChisaAlter" },
    ]);
    expect(splitLinkLines("看这个：\nhttps://github.com/ChisaAlter", { final: true }).links).toHaveLength(1);
  });

  test("流式：最后一行是普通文字就照常显示", () => {
    const out = splitLinkLines("第一行\n第二行写到一半", { final: false });
    expect(out).toEqual({ links: [], display: "第一行\n第二行写到一半", pending: false });
  });

  test("链接行的开头", () => {
    expect(looksLikePartialLinkLine("htt")).toBe(true);
    expect(looksLikePartialLinkLine("https://")).toBe(true);
    expect(looksLikePartialLinkLine("[下载 0.1.7](https://gi")).toBe(true);
    expect(looksLikePartialLinkLine("hello")).toBe(false);
    expect(looksLikePartialLinkLine("[注意")).toBe(false);
    expect(looksLikePartialLinkLine("https://a.cn 是")).toBe(false);
  });

  test("parseLinkLine 只认整行一个链接", () => {
    expect(parseLinkLine("  https://a.cn/x  ")).toEqual({ url: "https://a.cn/x" });
    expect(parseLinkLine("[a](https://a.cn) [b](https://b.cn)")).toBeNull();
    expect(parseLinkLine("![图](https://a.cn/a.png)")).toBeNull();
    expect(parseLinkLine("javascript:alert(1)")).toBeNull();
  });
});
