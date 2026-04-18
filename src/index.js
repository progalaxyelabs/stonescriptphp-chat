/**
 * @progalaxyelabs/stonescriptphp-chat
 *
 * Generic Socket.IO chat server with JWKS authentication and plugin hooks.
 * Attaches to any Node.js http.Server instance.
 *
 * Usage:
 *
 *   import http from 'node:http';
 *   import { createChatServer } from '@progalaxyelabs/stonescriptphp-chat';
 *
 *   const httpServer = http.createServer();
 *
 *   const chatServer = createChatServer({
 *     httpServer,
 *     jwks: {
 *       url:      process.env.JWKS_URL,
 *       issuer:   process.env.JWT_ISSUER,
 *       audience: process.env.JWT_AUDIENCE,
 *     },
 *     cors: { origin: process.env.CORS_ORIGINS?.split(',') ?? '*' },
 *     hooks: {
 *       resolveRoom: async (user, roomRequest) => `tenant:${user.tenant_id}:${roomRequest}`,
 *       persistMessage: async (msg) => db.messages.insert(msg),
 *     },
 *   });
 *
 *   httpServer.listen(3000);
 *
 *   // Publish a message from server-side code (e.g. from a PHP API webhook):
 *   chatServer.publish('tenant:abc:support', {
 *     id: 'server-001',
 *     roomId: 'tenant:abc:support',
 *     from: 'system',
 *     text: 'Your order has been shipped.',
 *     timestamp: new Date().toISOString(),
 *   });
 *
 * Events emitted to clients:
 *   'message'  — { id, roomId, from, text, timestamp }
 *   'typing'   — { roomId, from, isTyping }
 *   'presence' — { roomId, userId, event: 'joined'|'left' }
 *   'error'    — { message }
 *
 * Events received from clients:
 *   'join'     — { room: <roomRequest> }         → ack(err, roomId)
 *   'leave'    — { room: roomId }
 *   'message'  — { room: roomId, text: string }  → ack(err, msg)
 *   'typing'   — { room: roomId, isTyping: bool }
 */

import { Server } from 'socket.io';
import { createJwksVerifier } from './auth.js';
import { RoomRegistry } from './room-registry.js';
import { resolveHooks } from './plugin-hooks.js';
import { registerSocketHandlers } from './message-handler.js';

/**
 * Create a chat server instance.
 *
 * @param {object}   options
 * @param {import('node:http').Server} options.httpServer - Node HTTP server to attach to
 * @param {object}   [options.jwks]
 * @param {string}   [options.jwks.url]      - JWKS endpoint URL (falls back to JWKS_URL env)
 * @param {string}   [options.jwks.issuer]   - JWT issuer claim (falls back to JWT_ISSUER env)
 * @param {string}   [options.jwks.audience] - JWT audience claim (falls back to JWT_AUDIENCE env)
 * @param {object}   [options.cors]          - Socket.IO CORS options (passed directly to socket.io Server)
 * @param {object}   [options.hooks={}]      - Plugin hook overrides
 * @param {Function} [options.hooks.authenticateConnection] - async (socket, token) → userPayload
 * @param {Function} [options.hooks.resolveRoom]            - async (user, roomRequest) → roomId  [REQUIRED]
 * @param {Function} [options.hooks.authorizeRoom]          - async (user, roomId) → boolean
 * @param {Function} [options.hooks.persistMessage]         - async (msg) → void
 * @param {Function} [options.hooks.onMessageDelivered]     - async (msg, recipients) → void
 * @param {Function} [options.hooks.onUserJoin]             - async (user, roomId) → void
 * @param {Function} [options.hooks.onUserLeave]            - async (user, roomId) → void
 *
 * @returns {{
 *   io: import('socket.io').Server,
 *   registry: RoomRegistry,
 *   publish: (roomId: string, msg: object) => void,
 *   close: () => void,
 * }}
 */
export function createChatServer(options = {}) {
  const {
    httpServer,
    jwks,
    cors = { origin: '*' },
    hooks: hookOverrides = {},
  } = options;

  if (!httpServer) throw new Error('httpServer is required');

  // Read env-var fallbacks for JWKS config
  const jwksUrl      = jwks?.url      ?? process.env.JWKS_URL;
  const jwksIssuer   = jwks?.issuer   ?? process.env.JWT_ISSUER;
  const jwksAudience = jwks?.audience ?? process.env.JWT_AUDIENCE;

  const verifier = createJwksVerifier({
    url:      jwksUrl,
    issuer:   jwksIssuer,
    audience: jwksAudience,
  });

  const registry = new RoomRegistry();
  const hooks = resolveHooks(hookOverrides, verifier);

  const io = new Server(httpServer, {
    cors,
    // Disable HTTP long-polling fallback — WebSocket only for chat
    transports: ['websocket', 'polling'],
  });

  // ── Connection middleware — authenticate every connection ──────────────────

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token
      ?? socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

    try {
      const user = await hooks.authenticateConnection(socket, token);
      // Attach verified user to socket for downstream handlers
      socket.data.user = user;
      next();
    } catch (err) {
      // Pass the error to Socket.IO — client receives a connect_error event
      // with err.data set so the client can detect 'JWTExpired' etc.
      const authError = new Error(err.message ?? 'Authentication failed');
      authError.data = err.data ?? 'AuthError';
      next(authError);
    }
  });

  // ── Connection handler ────────────────────────────────────────────────────

  io.on('connection', (socket) => {
    const user = socket.data.user;

    // Register in the registry so we can clean up on disconnect
    registry.registerSocket(socket.id, user);

    // Register chat event listeners
    registerSocketHandlers({ socket, io, user, registry, hooks });

    // ── Disconnect ──────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      const rooms = registry.removeSocket(socket.id);

      for (const roomId of rooms) {
        // Notify remaining room members
        socket.to(roomId).emit('presence', {
          roomId,
          userId: user.sub,
          event: 'left',
        });

        await hooks.onUserLeave(user, roomId);
      }
    });
  });

  return {
    /** The raw Socket.IO Server instance — for advanced use */
    io,

    /** In-memory room registry — read-only introspection */
    registry,

    /**
     * Publish a message to all sockets in a room (server-side push).
     *
     * @param {string} roomId
     * @param {object} msg
     */
    publish(roomId, msg) {
      io.to(roomId).emit('message', msg);
    },

    /**
     * Close the Socket.IO server (useful in tests / graceful shutdown).
     */
    close() {
      io.close();
    },
  };
}
