export function uniqueChannelNameForTest(topic: string) {
  return `${topic}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}
