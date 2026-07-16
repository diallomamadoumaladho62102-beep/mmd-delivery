import { supabase } from "@/lib/supabaseBrowser";
import {
  buildChatImageStoragePath,
  CHAT_IMAGE_BUCKET,
  toChatImagePath,
  validateChatImageFile,
} from "@/lib/chatUploadSecurity";

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
  roles?: { senderRole?: string | null; targetRole?: string | null },
) {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const userId = userData?.user?.id;

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

  const payload: Record<string, unknown> = {
    order_id: orderId,
    text: text?.trim() || null,
    image_path: imagePath,
    user_id: userId || null,
    sender_role: roles?.senderRole ?? null,
    target_role: roles?.targetRole ?? null,
  };

  const { data, error } = await supabase
    .from("order_messages")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    if (imagePath) {
      const storageKey = imagePath.replace(/^chat-images\//, "");
      await supabase.storage.from(CHAT_IMAGE_BUCKET).remove([storageKey]).catch(() => {});
    }
    throw error;
  }

  return data;
}
