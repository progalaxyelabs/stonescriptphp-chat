# @progalaxyelabs/stonescriptphp-chat

Generic Socket.IO chat server with JWKS authentication and plugin hooks. Designed to plug into any StoneScriptPHP platform (or any Node.js service) with zero hardcoded tenant assumptions.

## Features

- **Socket.IO** (WebSocket) — real-time bidirectional chat
- **JWKS authentication** — RS256 / ES256 only; `alg=none` and HS256 rejected before key lookup
- **Plugin hooks** — `resolveRoom`, `persistMessage`, `onUserJoin`, etc. keep business logic out of the library
- **In-memory room registry** — swappable for Redis via hooks for multi-node deployments
- **Delivery confirmations** — ack callbacks on `join` and `message` events
- **Presence events** — `joined` / `left` broadcast on connect/disconnect

## Install

```bash
npm install @progalaxyelabs/stonescriptphp-chat
```

## Quick Start

```js
import http from 'node:http';
import { createChatServer } from '@progalaxyelabs/stonescriptphp-chat';

const httpServer = http.createServer();

const chatServer = createChatServer({
  httpServer,
  jwks: {
    url:      process.env.JWKS_URL,      // e.g. https://auth.example.com/.well-known/jwks.json
    issuer:   process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
  },
  hooks: {
    // REQUIRED — scope rooms by tenant so tenants never bleed into each other
    resolveRoom: async (user, roomRequest) => `${user.tenant_id}:${roomRequest}`,

    // Optional — persist messages to your database
    persistMessage: async (msg) => {
      await db.query('INSERT INTO messages ...', [msg.id, msg.roomId, msg.from, msg.text]);
    },
  },
});

httpServer.listen(process.env.PORT ?? 3000);
```

## Environment Variables

| Variable         | Required | Description                                    |
|-----------------|----------|------------------------------------------------|
| `JWKS_URL`      | Yes      | Remote JWKS endpoint URL                       |
| `JWT_ISSUER`    | Yes      | Expected `iss` claim in JWT                    |
| `JWT_AUDIENCE`  | Yes      | Expected `aud` claim in JWT                    |
| `REDIS_URL`     | No       | For multi-node deployments (via custom hooks)  |
| `PORT`          | No       | HTTP server port (default: 3000)               |
| `CORS_ORIGINS`  | No       | Comma-separated allowed origins                |

## Plugin Hooks

All hooks are `async` functions. Provide them in the `hooks` option to `createChatServer`.

### `authenticateConnection(socket, token)` → `userPayload`

Verify the JWT and return the user payload. Default delegates to the JWKS verifier.

### `resolveRoom(user, roomRequest)` → `roomId`  *(REQUIRED)*

Map a user and room request to a concrete room ID. Use this to scope rooms by tenant:

```js
resolveRoom: async (user, roomRequest) => `tenant:${user.tenant_id}:${roomRequest}`
```

### `authorizeRoom(user, roomId)` → `boolean`

Return `false` to deny access. Default: allow all authenticated users.

### `persistMessage(msg)` → `void`

Store the message to your database. Called after delivery (fire-and-forget — errors don't affect delivery).

### `onMessageDelivered(msg, recipients)` → `void`

Called after a message is sent, with the list of recipient socket IDs.

### `onUserJoin(user, roomId)` → `void`

Called when a user successfully joins a room.

### `onUserLeave(user, roomId)` → `void`

Called when a user leaves a room (disconnect or explicit leave).

## Client Events (Socket.IO)

### Client → Server

| Event     | Payload                                    | Ack              |
|-----------|-------------------------------------------|------------------|
| `join`    | `{ room: roomRequest }`                   | `(err, roomId)`  |
| `leave`   | `{ room: roomId }`                        | —                |
| `message` | `{ room: roomId, text: string }`          | `(err, msg)`     |
| `typing`  | `{ room: roomId, isTyping: boolean }`     | —                |

### Server → Client

| Event      | Payload                                                      |
|------------|--------------------------------------------------------------|
| `message`  | `{ id, roomId, from, text, timestamp }`                      |
| `typing`   | `{ roomId, from, isTyping }`                                 |
| `presence` | `{ roomId, userId, event: 'joined' \| 'left' }`              |
| `error`    | `{ message }`                                                |

## Authentication (Client Side)

Pass the JWT in the `auth` option when connecting:

```js
import { io } from 'socket.io-client';

const socket = io('wss://chat.example.com', {
  auth: { token: yourJwtToken },
  transports: ['websocket'],
});

socket.on('connect_error', (err) => {
  if (err.data === 'JWTExpired') {
    // Refresh token and reconnect
  }
});
```

## Server-Side Push

Publish a message to a room from your application code (e.g. triggered by a webhook from the PHP API):

```js
chatServer.publish('tenant:abc:support', {
  id: crypto.randomUUID(),
  roomId: 'tenant:abc:support',
  from: 'system',
  text: 'Your order has been shipped.',
  timestamp: new Date().toISOString(),
});
```

## Multi-Node Deployments (Redis)

For horizontal scaling, override the room hooks to use Redis Pub/Sub:

```js
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();
await Promise.all([pubClient.connect(), subClient.connect()]);

const chatServer = createChatServer({ httpServer, jwks, hooks });
chatServer.io.adapter(createAdapter(pubClient, subClient));
```

## License

MIT
