/** First 16 hex digits of the SHA-256 of some bytes: the revision `scripts/pwa.ts` records for every file. */
export async function hash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

/** Fetches a file bypassing HTTP caches and accepts it only if its bytes match the expected revision (one retry). */
export async function verifiedFetch(url: string, revision: string): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const address = new URL(url);
      address.searchParams.set('__rev', revision);
      const response = await fetch(address, { cache: 'no-store' });
      if (!response.ok) throw new Error('Precache response failed');
      const bytes = await response.arrayBuffer();
      if ((await hash(bytes)) !== revision) throw new Error('Precache revision mismatch');
      return new Response(bytes, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  throw new Error('Precache download failed');
}
