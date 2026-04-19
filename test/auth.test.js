/**
 * Tests for auth.js — JWKS verifier algorithm allowlist.
 *
 * These tests mock the jose JWKS fetch so they run without a live JWKS server.
 * Key assertions:
 *   - alg=none  → 401 (rejected before key lookup)
 *   - alg=HS256 → 401 (rejected before key lookup)
 *   - alg=RS256 → proceeds to JWKS verification (will fail on signature, not alg)
 *   - Missing token → 401
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createJwksVerifier } from '../src/auth.js';

/**
 * Build a fake JWT with a given algorithm in the header.
 * The payload and signature are irrelevant for algorithm-allowlist tests.
 */
function fakeJwt(alg, payload = {}) {
  const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({ sub: 'user-1', iss: 'test-issuer', aud: 'test-audience', ...payload })
  ).toString('base64url');
  const sig = 'fakesig';
  return `${header}.${body}.${sig}`;
}

describe('auth.js — algorithm allowlist', () => {
  it('rejects alg=none before key lookup', async () => {
    const verifier = createJwksVerifier({
      url: 'https://example.com/.well-known/jwks.json',
      issuer: 'test-issuer',
      audience: 'test-audience',
    });

    const token = fakeJwt('none');
    await assert.rejects(
      () => verifier.verify(token),
      (err) => {
        assert.equal(err.status, 401);
        assert.match(err.message, /not allowed/i);
        return true;
      }
    );
  });

  it('rejects alg=HS256 before key lookup', async () => {
    const verifier = createJwksVerifier({
      url: 'https://example.com/.well-known/jwks.json',
      issuer: 'test-issuer',
      audience: 'test-audience',
    });

    const token = fakeJwt('HS256');
    await assert.rejects(
      () => verifier.verify(token),
      (err) => {
        assert.equal(err.status, 401);
        assert.match(err.message, /HS256.*not allowed/i);
        return true;
      }
    );
  });

  it('rejects missing/null token', async () => {
    const verifier = createJwksVerifier({
      url: 'https://example.com/.well-known/jwks.json',
      issuer: 'test-issuer',
      audience: 'test-audience',
    });

    await assert.rejects(
      () => verifier.verify(null),
      (err) => {
        assert.equal(err.status, 401);
        assert.match(err.message, /missing token/i);
        return true;
      }
    );
  });

  it('rejects malformed JWT (non-base64 header)', async () => {
    const verifier = createJwksVerifier({
      url: 'https://example.com/.well-known/jwks.json',
      issuer: 'test-issuer',
      audience: 'test-audience',
    });

    await assert.rejects(
      () => verifier.verify('!!!.body.sig'),
      (err) => {
        assert.equal(err.status, 401);
        return true;
      }
    );
  });

  it('throws on missing url', () => {
    assert.throws(
      () => createJwksVerifier({ url: '', issuer: 'iss', audience: 'aud' }),
      /JWKS url is required/
    );
  });

  it('throws on missing issuer', () => {
    assert.throws(
      () => createJwksVerifier({ url: 'https://example.com/.well-known/jwks.json', issuer: '', audience: 'aud' }),
      /JWT issuer is required/
    );
  });

  it('allows missing audience (optional since v0.1.1)', () => {
    assert.doesNotThrow(
      () => createJwksVerifier({ url: 'https://example.com/.well-known/jwks.json', issuer: 'iss' })
    );
  });
});
