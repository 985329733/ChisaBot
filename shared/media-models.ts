/**
 * 生图模型 / 识图模型（DESIGN.md §59，docs/chat-files.md）。服务器和网页共用的类型。
 *
 * - 管理员在 设置 → 模型 里给所有人设默认：生图（沿用 chisabot_image_settings 那一行）和识图
 *   （「跟随主模型」或单独的 OpenAI 兼容看图模型）。
 * - 每个人可以在 设置 → 生图与识图 里换成自己的接口 / 密钥 / 模型；没设就用管理员的默认。
 * - 密钥只进不出：页面只看到末四位，机器人的上下文里永远没有。
 */
import type { ImageProviderKind, ImageSettingsView } from "./chat-files";

/** 识图：跟随主模型（图片直接给聊天模型看）/ 单独的看图模型。 */
export type VisionMode = "follow" | "custom";
/** 个人设置：default = 用管理员的默认。 */
export type PersonalImageMode = "default" | "custom";
export type PersonalVisionMode = "default" | VisionMode;

export type KeyView = {
  /** saved = 存过的密钥；none = 没有。 */
  keySource: "saved" | "none";
  /** 末四位（密钥 ≥ 8 位时）。 */
  keyHint: string;
};

export type VisionSettingsView = KeyView & {
  mode: VisionMode;
  baseUrl: string;
  model: string;
  /** mode = custom 且接口、模型、密钥都齐了。 */
  ready: boolean;
  updatedAt: string | null;
};

export type PersonalImageView = KeyView & {
  mode: PersonalImageMode;
  provider: ImageProviderKind;
  baseUrl: string;
  model: string;
  editModel: string;
  ready: boolean;
  updatedAt: string | null;
};

export type PersonalVisionView = KeyView & {
  mode: PersonalVisionMode;
  baseUrl: string;
  model: string;
  ready: boolean;
  updatedAt: string | null;
};

/** 管理员默认的摘要（个人页显示「默认：…」用，不带密钥信息）。 */
export type MediaDefaultsSummary = {
  image: { ready: boolean; provider: ImageProviderKind; model: string };
  vision: { mode: VisionMode; ready: boolean; model: string };
};

export type MediaAdminView = { image: ImageSettingsView; vision: VisionSettingsView };
export type MediaPersonalView = {
  image: PersonalImageView;
  vision: PersonalVisionView;
  defaults: MediaDefaultsSummary;
  /** 管理员可以填内网地址；普通用户只能填公网地址。 */
  privateUrlsAllowed: boolean;
};

export type MediaProbeResult = { ok: boolean; message: string };

export const VISION_PRESET = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
};
