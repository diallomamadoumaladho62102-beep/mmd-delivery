export const MIN_PASSWORD_LENGTH = 8;

export function validatePassword(password: string): string | null {
  const value = String(password ?? "");
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}
