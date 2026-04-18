/**
 * Default plugin hook implementations for stonescriptphp-chat.
 *
 * All hooks are async functions. Consumers override them by passing a `hooks`
 * object to createChatServer(). Any hook not provided falls back to the
 * defaults defined here.
 *
 * Hook signatures:
 *
 *   authenticateConnection(socket, token) → Promise<object>
 *     Verify the token and return the user payload. Throw with status=401 on failure.
 *     Default: delegates to the JWKS verifier.
 *
 *   resolveRoom(user, roomRequest) → Promise<string>
 *     Map a user + room request to a concrete room ID. REQUIRED — consumer must
 *     provide this to scope rooms by tenant/context. Default throws if not provided.
 *
 *   authorizeRoom(user, roomId) → Promise<boolean>
 *     Return true to allow the user to join the resolved roomId, false to deny.
 *     Default: allow all authenticated users.
 *
 *   persistMessage(msg) → Promise<void>
 *     Called after a message is dispatched. Store to DB or audit log. Optional.
 *     Default: no-op.
 *
 *   onMessageDelivered(msg, recipients) → Promise<void>
 *     Called after delivery with the message and recipient socket IDs. Optional.
 *     Default: no-op.
 *
 *   onUserJoin(user, roomId) → Promise<void>
 *     Called after a user successfully joins a room. Optional.
 *     Default: no-op.
 *
 *   onUserLeave(user, roomId) → Promise<void>
 *     Called after a user leaves a room (disconnect or explicit leave). Optional.
 *     Default: no-op.
 */

/**
 * Default: delegate to the JWKS verifier that was configured in createChatServer().
 *
 * @param {import('socket.io').Socket} _socket - Not used in default implementation
 * @param {string} token - Raw JWT
 * @param {{ verify: Function }} verifier
 * @returns {Promise<object>} Verified JWT payload
 */
export async function defaultAuthenticateConnection(_socket, token, verifier) {
  return verifier.verify(token);
}

/**
 * Default resolveRoom — MUST be overridden by the consumer.
 * Throws an error to remind the integrator to provide a room resolver.
 *
 * @param {object} _user
 * @param {*} _roomRequest
 */
// eslint-disable-next-line no-unused-vars
export async function defaultResolveRoom(_user, _roomRequest) {
  throw new Error(
    'hooks.resolveRoom is required. Provide it to scope rooms by tenant or context.'
  );
}

/**
 * Default: allow all authenticated users to join any room.
 *
 * @param {object} _user
 * @param {string} _roomId
 * @returns {Promise<boolean>}
 */
// eslint-disable-next-line no-unused-vars
export async function defaultAuthorizeRoom(_user, _roomId) {
  return true;
}

/**
 * Default: no-op message persistence.
 *
 * @param {object} _msg
 * @returns {Promise<void>}
 */
// eslint-disable-next-line no-unused-vars
export async function defaultPersistMessage(_msg) {}

/**
 * Default: no-op delivery callback.
 *
 * @param {object} _msg
 * @param {string[]} _recipients
 * @returns {Promise<void>}
 */
// eslint-disable-next-line no-unused-vars
export async function defaultOnMessageDelivered(_msg, _recipients) {}

/**
 * Default: no-op on user join.
 *
 * @param {object} _user
 * @param {string} _roomId
 * @returns {Promise<void>}
 */
// eslint-disable-next-line no-unused-vars
export async function defaultOnUserJoin(_user, _roomId) {}

/**
 * Default: no-op on user leave.
 *
 * @param {object} _user
 * @param {string} _roomId
 * @returns {Promise<void>}
 */
// eslint-disable-next-line no-unused-vars
export async function defaultOnUserLeave(_user, _roomId) {}

/**
 * Merge consumer-provided hooks with defaults.
 * Only the hooks the consumer explicitly provides are overridden.
 *
 * @param {object} [overrides]
 * @param {{ verify: Function }} verifier - JWKS verifier, injected into authenticateConnection default
 * @returns {object} Resolved hook set
 */
export function resolveHooks(overrides = {}, verifier) {
  return {
    authenticateConnection: overrides.authenticateConnection
      ?? ((socket, token) => defaultAuthenticateConnection(socket, token, verifier)),

    resolveRoom: overrides.resolveRoom ?? defaultResolveRoom,

    authorizeRoom: overrides.authorizeRoom ?? defaultAuthorizeRoom,

    persistMessage: overrides.persistMessage ?? defaultPersistMessage,

    onMessageDelivered: overrides.onMessageDelivered ?? defaultOnMessageDelivered,

    onUserJoin: overrides.onUserJoin ?? defaultOnUserJoin,

    onUserLeave: overrides.onUserLeave ?? defaultOnUserLeave,
  };
}
