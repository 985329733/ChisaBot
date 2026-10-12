import { describe, expect, test } from "bun:test";
import { parseInputMessage, parseNavigateUrl } from "../src/request-validation";
import {
  contentTypeFor,
  isWorkspaceUrl,
  workspacePathFromUrl,
  workspaceProblemPage,
  workspaceRequestAllowed,
  workspaceUrlFor,
} from "../src/workspace-origin";

/** 机器人自己写的网页：https://workspace.local/<路径> 从工作区读，从不出网。 */
describe("workspace origin", () => {
  test("file:///workspace/… becomes the workspace origin", () => {
    expect(workspaceUrlFor("file:///workspace/date.html")).toBe(
      "https://workspace.local/date.html",
    );
    expect(workspaceUrlFor("file://workspace/a/b.html?x=1#y")).toBe(
      "https://workspace.local/a/b.html?x=1#y",
    );
    expect(workspaceUrlFor("file:///workspace/%E6%97%A5%E6%9C%9F.html")).toBe(
      "https://workspace.local/%E6%97%A5%E6%9C%9F.html",
    );
  });

  test("any other file: url is left alone and still refused", () => {
    expect(workspaceUrlFor("file:///etc/passwd")).toBe("file:///etc/passwd");
    expect(workspaceUrlFor("file:///workspaces/x")).toBe("file:///workspaces/x");
    expect(parseNavigateUrl("file:///etc/passwd").ok).toBe(false);
    expect(parseNavigateUrl("https://example.com").ok).toBe(true);
  });

  test("navigation and the takeover address bar accept workspace files", () => {
    expect(parseNavigateUrl("file:///workspace/page.html")).toEqual({
      ok: true,
      url: "https://workspace.local/page.html",
    });
    expect(
      parseInputMessage({ type: "navigate", url: "file:///workspace/page.html" }),
    ).toEqual({
      ok: true,
      message: { type: "navigate", url: "https://workspace.local/page.html" },
    });
  });

  test("url → workspace path", () => {
    expect(isWorkspaceUrl("https://WORKSPACE.local/x")).toBe(true);
    expect(isWorkspaceUrl("https://workspace.local.evil.com/x")).toBe(false);
    expect(workspacePathFromUrl("https://workspace.local/")).toBe("index.html");
    expect(workspacePathFromUrl("https://workspace.local/site/")).toBe("site/index.html");
    expect(workspacePathFromUrl("https://workspace.local/%E6%97%A5.html?q")).toBe("日.html");
    // Traversal is decoded here and refused by workspace.ts, which owns the boundary.
    expect(workspacePathFromUrl("https://workspace.local/..%2F..%2Fetc/passwd")).toBe(
      "../../etc/passwd",
    );
    expect(workspacePathFromUrl("https://example.com/a.html")).toBeNull();
  });

  test("only top-level navigations and the workspace's own pages get files", () => {
    expect(
      workspaceRequestAllowed({ isNavigationRequest: true, isMainFrame: true, frameUrl: "https://evil.com/" }),
    ).toBe(true);
    expect(
      workspaceRequestAllowed({ isNavigationRequest: false, isMainFrame: true, frameUrl: "https://workspace.local/page.html" }),
    ).toBe(true);
    expect(
      workspaceRequestAllowed({ isNavigationRequest: false, isMainFrame: true, frameUrl: "https://evil.com/" }),
    ).toBe(false);
    expect(
      workspaceRequestAllowed({ isNavigationRequest: true, isMainFrame: false, frameUrl: "https://evil.com/" }),
    ).toBe(false);
    expect(
      workspaceRequestAllowed({ isNavigationRequest: false, isMainFrame: false, frameUrl: null }),
    ).toBe(false);
  });

  test("content types and the problem page", () => {
    expect(contentTypeFor("a.HTML")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("x.png")).toBe("image/png");
    expect(contentTypeFor("noext")).toBe("application/octet-stream");
    const page = workspaceProblemPage("<x>.html", "没有");
    expect(page).toContain("&lt;x&gt;.html");
    expect(page).not.toContain("<x>");
  });
});
