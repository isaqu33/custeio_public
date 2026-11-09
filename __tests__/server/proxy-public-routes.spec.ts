/**
 * @jest-environment node
 */
export {};

import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

function req(path: string, options: { signedIn?: boolean } = {}) {
  return new NextRequest(`http://localhost${path}`, {
    headers: options.signedIn ? { cookie: 'authjs.session-token=abc' } : undefined,
  });
}

// `NextResponse.next()` carries this header; a redirect carries `location`.
function isPassThrough(res: Response) {
  return res.headers.get('x-middleware-next') === '1';
}

describe('proxy public routes', () => {
  it('lets an anonymous visitor open an invite link', () => {
    expect(isPassThrough(proxy(req('/claim/' + 'a'.repeat(48))))).toBe(true);
  });

  it('still sends an anonymous visitor to /login from a protected page', () => {
    const res = proxy(req('/organization/dashboard'));

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location') as string).pathname).toBe('/login');
  });

  it('does not open every path that merely starts like the prefix', () => {
    // `/claimed` is not `/claim/…` — a prefix match must include the slash.
    const res = proxy(req('/claimed'));

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location') as string).pathname).toBe('/login');
  });

  it('sends a signed-in visitor of an invite link to the app, like /login does', () => {
    const res = proxy(req('/claim/' + 'a'.repeat(48), { signedIn: true }));

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location') as string).pathname).toBe('/');
  });

  it('keeps the claim API reachable without a session', () => {
    const post = new NextRequest('http://localhost/api/organizations/claim', { method: 'POST' });

    expect(isPassThrough(proxy(post))).toBe(true);
  });
});
