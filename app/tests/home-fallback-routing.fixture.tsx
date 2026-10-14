import { mock } from "bun:test";
import { createContext } from "react";

// Mock every export: bun's mock.module leaks into later files, and glass-shell imports
// TopBarOwnsSidebarToggle (a missing export there is an "unhandled error between tests").
mock.module("@/components/layout/sidebar-toggle", () => ({
  TopBarOwnsSidebarToggle: createContext(false),
  useSidebarToggleVisible: () => true,
  SidebarToggle: () => <button type="button">Toggle sidebar</button>,
  SidebarToggleBar: () => <div data-testid="sidebar-toggle-bar" />,
}));

