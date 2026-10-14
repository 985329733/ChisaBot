import type { CopilotChatProps } from "@copilotkit/react-core/v2";
import { queryOptions } from "@tanstack/react-query";
import { type ChatFileView, type ImageSettingsView, MAX_CHAT_FILE_BYTES } from "../../../shared/chat-files";
import { client } from "@/lib/client";
import { toast } from "@/components/ui/toast";

type AttachmentsConfig = NonNullable<CopilotChatProps["attachments"]>;

/** 聊天文件 + 图片生成（DESIGN.md §56，docs/chat-files.md）。 */
export const chatFileKeys = { imageSettings: ["chat-files", "image-settings"] as const };

export async function uploadChatFile(agentId: string, file: File): Promise<ChatFileView> {
  const form = new FormData();
  form.set("agentId", agentId);
  form.set("file", file, file.name);
  const response = await fetch("/api/chat-files", { method: "POST", body: form, credentials: "include" });
  const body = (await response.json().catch(() => null)) as { file?: ChatFileView; error?: string } | null;
  if (!response.ok || !body?.file) throw new Error(body?.error || (response.status === 413 ? "文件太大" : "上传失败，请重试"));
  return body.file;
}

/**
 * 机器人聊天的附件：选的 / 拖进来的 / 粘贴的文件先传到服务器（存进机器人工作区 uploads/），
 * 消息里只放 `/api/chat-files/<id>`，图片和文件卡都从本站读。
 */
export function botAttachments(agentId: string): AttachmentsConfig {
  return {
    enabled: true,
    maxSize: MAX_CHAT_FILE_BYTES,
    maxConcurrentUploads: 3,
    onUpload: async (file) => {
      const saved = await uploadChatFile(agentId, file);
      return {
        type: "url",
        value: saved.url,
        mimeType: saved.mimeType,
        metadata: { filename: saved.name, size: saved.size, chatFileId: saved.id },
      };
    },
    onUploadFailed: (error) => {
      toast.error(
        error.reason === "file-too-large"
          ? `「${error.file.name}」超过 20 MB`
          : error.reason === "invalid-type"
            ? `「${error.file.name}」这种文件不能上传`
            : error.message || "上传失败，请重试",
      );
    },
  };
}

export function imageSettingsQueryOptions() {
  return queryOptions({
    queryKey: chatFileKeys.imageSettings,
    queryFn: ({ signal }): Promise<ImageSettingsView> => client("/api/chat-files/settings/image", "settings", { fallback: "无法加载图片设置", signal }),
  });
}

export type ImageSettingsInput = {
  enabled: boolean;
  provider: "minimax" | "openai";
  baseUrl: string;
  model: string;
  editModel: string;
  apiKey?: string;
};

export function saveImageSettings(input: ImageSettingsInput): Promise<ImageSettingsView> {
  return client("/api/chat-files/settings/image", "settings", { method: "PUT", body: input, fallback: "保存失败，请重试" });
}

export async function testImageSettings(input: Partial<ImageSettingsInput>): Promise<{ ok: boolean; message: string }> {
  const response = await fetch("/api/chat-files/settings/image/test", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string } | null;
  if (!response.ok) throw new Error(body?.error || "检查失败");
  return { ok: Boolean(body?.ok), message: body?.message ?? "" };
}
