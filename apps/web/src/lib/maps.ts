export function mapsUrl(address: string) {
  return `https://www.google.com/maps?q=${encodeURIComponent(address || "")}`;
}

