export interface BuildInviteUrlOptions {
  groupId: string;
  invKeyHex: string;
  relayUrl?: string;
  baseUrl?: string;
}

/**
 * Constructs a fully qualified invitation URL using current window location origin & pathname.
 * Pure helper utility ensuring consistent URL formatting across dev, GitHub Pages, and production domains.
 */
export function buildInviteUrl(options: BuildInviteUrlOptions): string {
  const { groupId, invKeyHex, relayUrl, baseUrl } = options;

  let origin = '';
  let pathname = '';

  if (baseUrl) {
    const parsed = new URL(baseUrl);
    origin = parsed.origin;
    pathname = parsed.pathname;
  } else if (typeof window !== 'undefined' && window.location) {
    origin = window.location.origin;
    pathname = window.location.pathname;
  } else {
    origin = 'http://localhost';
    pathname = '/';
  }

  const cleanPathname = pathname.endsWith('/') ? pathname : `${pathname}/`;
  const relayQuery = relayUrl ? `&relay=${encodeURIComponent(relayUrl)}` : '';
  const hashRoute = `#/join?groupId=${encodeURIComponent(groupId)}&invKey=${invKeyHex}${relayQuery}`;

  return `${origin}${cleanPathname}${hashRoute}`;
}
