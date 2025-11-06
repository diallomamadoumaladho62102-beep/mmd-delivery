import { supabase } from "@/lib/supabaseBrowser";

export async function deleteMessageAndImage(msgId: string) {
  // 1) supprimer la ligne via RPC (et récupérer image_path/bucket)
  const { data, error } = await supabase.rpc("delete_order_message", { p_msg_id: msgId });
  if (error) throw error;

  // data peut être [] si déjà supprimé
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return;

  const { image_path, bucket } = row as { image_path?: string; bucket?: string };

  // 2) si image, suppression Storage (côté client)
  if (image_path) {
    const { error: delErr } = await supabase.storage.from(bucket || "chat-images").remove([image_path]);
    // on n'échoue pas la suppression du message si l'image manque déjà
    if (delErr && delErr.message?.includes("Object not found") === false) {
      console.warn("Storage remove warning:", delErr.message);
    }
  }
}

export async function sendChatMessage(orderId: string, text: string, file: File | null) {
  // 0) récupérer l'utilisateur pour user_id
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const userId = userData?.user?.id;

  let imagePath: string | null = null;
  const bucket = "chat-images";

  // 1) upload si fichier
  if (file) {
    // chemin: <orderId>/<timestamp>-<sanitized-name>
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${orderId}/${Date.now()}-${safeName}`;

    const { error: upErr } = await supabase
      .storage
      .from(bucket)
      .upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || "application/octet-stream",
      });
    if (upErr) throw upErr;
    imagePath = path;
  }

  // 2) insérer le message (texte + image_path si présent)
  const payload: any = {
    order_id: orderId,
    text: text?.trim() || null,
    image_path: imagePath,
    bucket,
    user_id: userId || null, // si trigger user_id absent, on envoie quand même
  };

  const { data, error } = await supabase
    .from("order_messages")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    // si upload fait mais insert échoue: rollback image (best-effort)
    if (imagePath) {
      await supabase.storage.from(bucket).remove([imagePath]).catch(() => {});
    }
    throw error;
  }

  return data;
}
