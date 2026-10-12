import { describe, expect, test } from "bun:test";
import { assertPublicUrl, htmlToText, parseDuckDuckGo } from "../src/web/tools";
import { clampRefresh } from "../src/live-panels/store";

describe("web tools", () => {
  test("parses DuckDuckGo html results and unwraps redirect links", () => {
    const html = `<div class="result results_links results_links_deep web-result "><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=1">Example &amp; A</a><a class="result__snippet" href="#">Snippet <b>bold</b></a></div>`;
    expect(parseDuckDuckGo(html)).toEqual([{ title: "Example & A", url: "https://example.com/a", snippet: "Snippet bold" }]);
  });
  test("html to text keeps headings and drops scripts", () => {
    const { title, text } = htmlToText("<html><title>T &amp; U</title><body><script>x()</script><h1>Hi</h1><p>One</p><ul><li>a</li></ul></body></html>");
    expect(title).toBe("T & U");
    expect(text).toContain("# Hi");
    expect(text).toContain("- a");
    expect(text).not.toContain("x()");
  });
  test("refuses private addresses", async () => {
    await expect(assertPublicUrl("http://127.0.0.1/")).rejects.toThrow();
    await expect(assertPublicUrl("http://10.1.2.3/")).rejects.toThrow();
    await expect(assertPublicUrl("http://[::1]/")).rejects.toThrow();
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow();
    await expect(assertPublicUrl("http://localhost:3000/")).rejects.toThrow();
  });
  test("live panel refresh floor is one hour", () => {
    expect(clampRefresh(5)).toBe(60);
    expect(clampRefresh(0)).toBeNull();
    expect(clampRefresh(1440)).toBe(1440);
  });
});
