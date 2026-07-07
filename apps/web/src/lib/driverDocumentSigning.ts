import type { SupabaseClient } from "@supabase/supabase-js";

const DRIVER_DOCUMENT_BUCKETS = [
  "driver-docs",
  "driver-documents",
  "avatars",
] as const;

export async function createSignedDriverDocumentUrl(
  admin: SupabaseClient,
  filePath: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  for (const bucket of DRIVER_DOCUMENT_BUCKETS) {
    const { data, error } = await admin.storage
      .from(bucket)
      .createSignedUrl(filePath, expiresInSeconds);

    if (!error && data?.signedUrl) return data.signedUrl;
  }

  return null;
}

export async function loadDriverProfilePhotoSignedUrl(
  admin: SupabaseClient,
  driverId: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const { data: doc } = await admin
    .from("driver_documents")
    .select("file_path")
    .eq("user_id", driverId)
    .eq("doc_type", "profile_photo")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!doc?.file_path) return null;

  return createSignedDriverDocumentUrl(admin, String(doc.file_path), expiresInSeconds);
}
