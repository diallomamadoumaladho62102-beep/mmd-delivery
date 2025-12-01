"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export default function WhoAmI() {
  const [uid, setUid] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        console.error(error.message);
      } else if (data?.user) {
        setUid(data.user.id);
        setEmail(data.user.email ?? null);
      }
    })();
  }, []);

  return (
    <div className="max-w-lg mx-auto p-4 space-y-2 border rounded-xl mt-6">
      <h1 className="text-xl font-bold">🔐 Who Am I?</h1>
      {uid ? (
        <>
          <div>
            <strong>User ID:</strong> <span className="break-all">{uid}</span>
          </div>
          {email && (
            <div>
              <strong>Email:</strong> {email}
            </div>
          )}
        </>
      ) : (
        <p className="text-gray-500">Aucun utilisateur connecté.</p>
      )}
    </div>
  );
}

