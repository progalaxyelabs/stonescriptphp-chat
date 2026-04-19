/**
 * JWKS authentication helper for stonescriptphp-chat.
 *
 * Only RS256 and ES256 are accepted. Any other algorithm — including HS256 and
 * the dangerous "none" pseudo-algorithm — is rejected with a 401.
 *
 * Clock skew tolerance is capped at 60 seconds.
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';

/** Algorithms that are permitted. Everything else is rejected. */
const ALLOWED_ALGORITHMS = ['RS256', 'ES256'];

/**
 * Build a JWT verifier backed by a remote JWKS endpoint.
 *
 * @param {object} config
 * @param {string} config.url      - Remote JWKS URL (e.g. https://auth.example.com/.well-known/jwks.json)
 * @param {string} config.issuer   - Expected JWT issuer (`iss` claim)
 * @param {string} [config.audience] - Expected JWT audience (`aud` claim). Optional — if not provided, aud is not validated.
 * @returns {{ verify: (token: string) => Promise<object> }}
 */
export function createJwksVerifier({ url, issuer, audience }) {
  if (!url) throw new Error('JWKS url is required');
  if (!issuer) throw new Error('JWT issuer is required');
  // audience is optional — some auth providers don't set aud claims

  const JWKS = createRemoteJWKSet(new URL(url));

  /**
   * Verify a Bearer token string.
   *
   * @param {string} token - Raw JWT (no "Bearer " prefix)
   * @returns {Promise<object>} Verified payload
   * @throws {Error} with status=401 for any auth failure
   */
  async function verify(token) {
    if (!token || typeof token !== 'string') {
      throw Object.assign(new Error('Missing token'), { status: 401 });
    }

    // Peek at the header to reject disallowed algorithms BEFORE key lookup.
    // jose's jwtVerify also enforces this via `algorithms`, but an early check
    // gives a clearer error message.
    let header;
    try {
      const [headerB64] = token.split('.');
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    } catch {
      throw Object.assign(new Error('Malformed JWT header'), { status: 401 });
    }

    if (!header.alg || !ALLOWED_ALGORITHMS.includes(header.alg)) {
      throw Object.assign(
        new Error(`Algorithm "${header.alg}" is not allowed. Permitted: ${ALLOWED_ALGORITHMS.join(', ')}`),
        { status: 401 }
      );
    }

    try {
      const verifyOptions = {
        issuer,
        algorithms: ALLOWED_ALGORITHMS,
        clockTolerance: 60, // seconds
      };
      // Only validate audience if configured
      if (audience) {
        verifyOptions.audience = audience;
      }
      const { payload } = await jwtVerify(token, JWKS, verifyOptions);
      return payload;
    } catch (err) {
      throw Object.assign(
        new Error(`JWT verification failed: ${err.message}`),
        { status: 401, cause: err }
      );
    }
  }

  return { verify };
}
