import { supabase } from "@/lib/supabaseBrowser";
import {
  buildChatImageStoragePath,
  CHAT_IMAGE_BUCKET,
  toChatImagePath,
  validateChatImageFile,
} from "@/lib/chatUploadSecurity";
import { sendChatMessageViaApi } from "@/lib/chatApiClient";

export async function deleteMessageAndImage(msgId: string) {
  const { data, error } = await supabase.rpc("delete_order_message", {
    p_msg_id: msgId,
  });
  if (error) throw error;

  const row = (data ?? null) as {
    ok?: boolean;
    image_path?: string | null;
    bucket?: string | null;
  } | null;

  if (!row?.ok) return;

  const imagePath = String(row.image_path ?? "").trim();
  if (!imagePath) return;

  const bucket = String(row.bucket ?? CHAT_IMAGE_BUCKET).trim() || CHAT_IMAGE_BUCKET;
  const storageKey = imagePath.replace(new RegExp(`^${bucket}/`), "");

  const { error: delErr } = await supabase.storage.from(bucket).remove([storageKey]);
  if (delErr && delErr.message?.includes("Object not found") === false) {
    console.warn("Storage remove warning:", delErr.message);
  }
}

export async function sendChatMessage(
  orderId: string,
  text: string,
  file: File | null,
  roles?: { senderRole?: string | null; targetRole?: string | null; targetUserId?: string | null },
) {
  let imagePath: string | null = null;

  if (file) {
    validateChatImageFile(file);
    const ext = file.name.split(".").pop() || "jpg";
    const key = buildChatImageStoragePath(orderId, ext);

    const { error: upErr } = await supabase.storage
      .from(CHAT_IMAGE_BUCKET)
      .upload(key, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || "application/octet-stream",
      });
    if (upErr) throw upErr;
    imagePath = toChatImagePath(key);
  }

  const result = await sendChatMessageViaApi({
    orderId,
    text: text?.trim() || null,
    imagePath,
    senderRole: roles?.senderRole ?? null,
    targetRole: roles?.targetRole ?? null,
    targetUserId: roles?.targetUserId ?? null,
  });

  if (!result.ok) {
    if (imagePath) {
      const storageKey = imagePath.replace(/^chat-images\//, "");
      await supabase.storage.from(CHAT_IMAGE_BUCKET).remove([storageKey]).catch(() => {});
    }
    throw new Error(result.error ?? "send_failed");
  }

  return result.message;
}
