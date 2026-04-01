'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseBrowser';
import Avatar from '@/components/Avatar';

type Profile = { full_name: string | null; avatar_url: string | null };
type ProfileJoin = Profile | Profile[] | null | undefined;

type Msg = {
  id: number;
  user_id: string;
  order_id: string;
  message: string | null;
  image_path: string | null;
  created_at: string;
  profiles?: ProfileJoin; // ✅ via FK (Supabase peut renvoyer un tableau)
};

type Props = { orderId: string };

// Petit util pour formater la date localement
function fmt(d: string) {
  try {
    return new Date(d).toLocaleString();
  } catch {
    return d;
  }
}

function normalizeProfile(p: ProfileJoin): Profile | null {
  if (!p) return null;
  if (Array.isArray(p)) return p[0] ?? null;
  return p;
}

export default function MessagesList({ orderId }: Props) {
  const [items, setItems] = useState<
    (Omit<Msg, 'profiles'> & { profiles?: Profile | null; _signedUrl?: string | null })[]
  >([]);
  const [loading, setLoading] = useState(true);

  const signedCache = useMemo(() => new Map<string, string>(), []);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const userIdRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const pingRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // ✅ Ton fichier est ici: apps/web/public/sounds/notify.mp3
    pingRef.current = new Audio('/sounds/notify.mp3');
  }, []);

  // Récupérer l'utilisateur courant (pour ne pas jouer un son sur nos propres messages)
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      userIdRef.current = data?.user?.id ?? null;
    });
  }, []);

  // ✅ Helper: supprimer une image (si tu ajoutes un bouton delete plus tard)
  async function removeImage(msgId: number, imagePath: string) {
    try {
      await supabase.storage.from('chat-uploads').remove([imagePath]);
      signedCache.delete(imagePath);

      // On met à jour l’UI localement
      setItems((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, image_path: null, _signedUrl: null } : m
        )
      );
    } catch (e) {
      console.error('removeImage error', e);
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function fetchInitial() {
      setLoading(true);

      const { data, error } = await supabase
        .from('order_messages')
        .select(
          `
          id, user_id, order_id, message, image_path, created_at,
          profiles:profiles!order_messages_user_id_fkey ( full_name, avatar_url )
        `
        )
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error(error);
        setLoading(false);
        return;
      }

      const withUrls = await Promise.all(
        (data || []).map(async (m) => {
          const msg = m as unknown as Msg;

          let _signedUrl: string | null = null;

          if (msg.image_path) {
            const key = msg.image_path;

            if (signedCache.has(key)) {
              _signedUrl = signedCache.get(key)!;
            } else {
              const { data: signed } = await supabase.storage
                .from('chat-uploads')
                .createSignedUrl(msg.image_path, 60 * 10);

              _signedUrl = signed?.signedUrl || null;
              if (_signedUrl) signedCache.set(key, _signedUrl);
            }
          }

          return { ...msg, profiles: normalizeProfile(msg.profiles), _signedUrl };
        })
      );

      if (!isMounted) return;

      setItems(withUrls);
      setLoading(false);
      mountedRef.current = true;

      setTimeout(
        () => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }),
        0
      );
    }

    fetchInitial();

    // Realtime
    const ch = supabase
      .channel(`order_messages:${orderId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_messages',
          filter: `order_id=eq.${orderId}`,
        },
        async (payload) => {
          if (!mountedRef.current) return;

          // Helper pour enrichir profil + image signée
          const enrich = async (raw: unknown) => {
            const mm = raw as Msg;
            const m: Msg = { ...mm, profiles: normalizeProfile(mm.profiles) };

            // Join profil (full_name, avatar_url) si absent
            if (!m.profiles) {
              const { data: prof } = await supabase
                .from('profiles')
                .select('full_name, avatar_url')
                .eq('id', m.user_id)
                .single();

              m.profiles = prof || null;
            }

            // Signed URL pour image_path
            let _signedUrl: string | null = null;

            if (m.image_path) {
              const key = m.image_path;

              if (signedCache.has(key)) _signedUrl = signedCache.get(key)!;
              else {
                const { data: signed } = await supabase.storage
                  .from('chat-uploads')
                  .createSignedUrl(m.image_path, 60 * 10);

                _signedUrl = signed?.signedUrl || null;
                if (_signedUrl) signedCache.set(key, _signedUrl);
              }
            }

            return { ...m, profiles: normalizeProfile(m.profiles), _signedUrl };
          };

          if (payload.eventType === 'INSERT') {
            const m = await enrich(payload.new);
            setItems((prev) => [...prev, m]);

            // 🔔 jouer un son si le message vient d'un autre utilisateur
            const current = userIdRef.current;
            if (pingRef.current && m.user_id !== current) {
              try {
                pingRef.current.currentTime = 0;
                await pingRef.current.play();
              } catch {}
            }

            setTimeout(
              () => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }),
              0
            );
          }

          if (payload.eventType === 'UPDATE') {
            const m = await enrich(payload.new);
            setItems((prev) => prev.map((x) => (x.id === m.id ? m : x)));
          }

          if (payload.eventType === 'DELETE') {
            const oldM = payload.old as Msg;
            setItems((prev) => prev.filter((x) => x.id !== oldM.id));
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(ch);
    };
  }, [orderId, signedCache]);

  if (loading) return <p className="text-sm text-gray-500">Chargement…</p>;

  if (!items.length)
    return (
      <div className="text-sm text-gray-500">
        Aucun message pour cette commande.
        <div ref={bottomRef} />
      </div>
    );

  return (
    <div className="space-y-3">
      {items.map((m) => (
        <div key={m.id} className="flex items-start gap-3">
          <Avatar
            name={m.profiles?.full_name ?? m.user_id}
            src={m.profiles?.avatar_url ?? null}
            size={36}
          />

          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-500">
              {m.profiles?.full_name || m.user_id}
            </div>

            {m.message && <div className="whitespace-pre-wrap">{m.message}</div>}

            {m._signedUrl ? (
              <div className="mt-2">
                <img
                  src={m._signedUrl}
                  alt="image"
                  className="max-w-full rounded-lg border"
                />
                {/* Exemple si tu veux activer la suppression plus tard :
                <button
                  onClick={() => m.image_path && removeImage(m.id, m.image_path)}
                  className="mt-2 text-xs text-red-600 underline"
                >
                  Supprimer l’image
                </button>
                */}
              </div>
            ) : null}

            <div className="text-[11px] text-gray-400 mt-1">{fmt(m.created_at)}</div>
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}