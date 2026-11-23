/** Family password gate (phase 1). Per-person logins come with result logging. */
export const COOKIE = 'nf_session';

/** Session token derived from the password, so changing APP_PASSWORD signs everyone out. */
export async function tokenFor(password: string): Promise<string> {
  const data = new TextEncoder().encode(`noskov-fitness:${password}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}
