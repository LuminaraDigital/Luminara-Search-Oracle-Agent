/**
 * A fake website for tests: public DNS for any host, then each path answers as given.
 * A path that is not listed is a 404. No sockets are opened.
 */
export type Served = { body: string; status?: number; type?: string; location?: string };
export type FakeSite = Record<string, Served>;

export function fakeSiteFetcher(site: FakeSite): typeof fetch {
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes('cloudflare-dns.com')) {
      const answer = url.includes('type=AAAA') ? [] : [{ type: 1, data: '104.21.8.8' }];
      return new Response(JSON.stringify({ Status: 0, Answer: answer }), { status: 200 });
    }
    const file = site[new URL(url).pathname];
    if (!file) return new Response('', { status: 404 });
    const headers: Record<string, string> = { 'content-type': file.type || 'text/plain' };
    if (file.location) headers.Location = file.location;
    return new Response(file.body, { status: file.status || 200, headers });
  };
  return fetcher as typeof fetch;
}

export const ROBOTS_OPEN = 'User-agent: *\nAllow: /\n';
export const LLMS_GOOD = '# Example Co\n\n> Example Co sells water filters to homes in Sydney and Melbourne.\n';
export const AI_TXT_GOOD = 'User-agent: *\nAllow: /\n';
export const ORGANIZATION_JSON_LD = '{"@context":"https://schema.org","@type":"Organization","name":"Example Co","url":"https://example-co.com"}';

const SENTENCE = 'Example Co fits and services under-sink water filters for homes in Sydney and Melbourne, with fixed prices and a two year warranty on every install.';

/** A homepage long enough not to be thin, carrying the JSON-LD blocks given (valid or not). */
export function homepage(jsonLdBlocks: readonly string[]): Served {
  const scripts = jsonLdBlocks.map((block) => `<script type="application/ld+json">${block}</script>`).join('\n');
  const paragraphs = Array.from({ length: 14 }, () => `<p>${SENTENCE}</p>`).join('\n');
  return {
    type: 'text/html; charset=utf-8',
    body: `<!DOCTYPE html>\n<html lang="en"><head><title>Example Co water filters</title>\n${scripts}\n</head><body><h1>Example Co water filters</h1>\n${paragraphs}\n</body></html>`,
  };
}
