import AsyncStorage from "@react-native-async-storage/async-storage";

export type LocalAiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

const CONVERSATION_ID_KEY = "mmd:ai:conversation_id";
const MESSAGES_KEY = "mmd:ai:messages";

function parseMessages(raw: string | null): LocalAiMessage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LocalAiMessage[];
    return Array.isArray(parsed) ? parsed.slice(-40) : [];
  } catch {
    return [];
  }
}

export async function loadAiLocalHistory(): Promise<{
  conversationId: string | null;
  messages: LocalAiMessage[];
}> {
  const [conversationId, messagesRaw] = await Promise.all([
    AsyncStorage.getItem(CONVERSATION_ID_KEY),
    AsyncStorage.getItem(MESSAGES_KEY),
  ]);

  return {
    conversationId: conversationId?.trim() || null,
    messages: parseMessages(messagesRaw),
  };
}

export async function saveAiLocalHistory(params: {
  conversationId: string;
  messages: LocalAiMessage[];
}): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(CONVERSATION_ID_KEY, params.conversationId),
    AsyncStorage.setItem(MESSAGES_KEY, JSON.stringify(params.messages.slice(-40))),
  ]);
}

export async function clearAiLocalHistory(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(CONVERSATION_ID_KEY),
    AsyncStorage.removeItem(MESSAGES_KEY),
  ]);
}

export function createLocalMessage(role: "user" | "assistant", content: string): LocalAiMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}
