import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type PostgresChangeBinding = {
  event: "*" | "INSERT" | "UPDATE" | "DELETE";
  schema?: string;
  table: string;
  filter?: string;
  callback: (payload: unknown) => void;
};

function uniqueChannelName(topic: string) {
  return `${topic}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export function subscribePostgresChannel(
  topic: string,
  bindings: PostgresChangeBinding[],
  onStatus?: (status: string) => void,
): RealtimeChannel {
  let channel = supabase.channel(uniqueChannelName(topic));

  for (const binding of bindings) {
    channel = channel.on(
      "postgres_changes",
      {
        event: binding.event,
        schema: binding.schema ?? "public",
        table: binding.table,
        filter: binding.filter,
      } as never,
      binding.callback,
    );
  }

  channel.subscribe(onStatus);
  return channel;
}

export async function unsubscribeSupabaseChannel(
  channel: RealtimeChannel | null | undefined,
) {
  if (!channel) return;
  try {
    await supabase.removeChannel(channel);
  } catch {
    // Channel may already be removed during fast navigation transitions.
  }
}
