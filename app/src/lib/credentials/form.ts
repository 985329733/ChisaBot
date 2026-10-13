import { z } from "zod";

export const credentialFormSchema = z.object({
  kind: z.enum(["model", "connector"]),
  provider: z.string().trim().min(1, "请填写提供方。"),
  keyId: z.string().trim().min(1, "请填写密钥 ID。"),
  plaintext: z.string().min(1, "请填写密钥。"),
});

export type CredentialFormValues = z.infer<typeof credentialFormSchema>;
