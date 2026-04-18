/**
 * Integration tests for createChatServer — end-to-end Socket.IO flows.
 *
 * Uses a real Socket.IO server on a random port + socket.io-client to connect.
 * All tests use stub auth (no live JWKS) by overriding authenticateConnection hook.
 *
 * Test cases:
 *   1. alg=none JWT → disconnect with auth error
 *   2. Valid JWT → ack + joined default room
 *   3. Send message to room → all room members receive it
 *   4. resolveRoom hook receives user context correctly
 *   5. User disconnect → presence event emitted to room
 *   6. Invalid room access (authorizeRoom returns false) → error, no join
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as ioc } from 'socket.io-client';
import { createChatServer } from '../src/index.js';

/** Build a fake JWT with a given algorithm (no signature validation in stub auth). */
function fakeJwt(alg, payload = {}) {
  const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({ sub: 'user-1', iss: 'test-issuer', aud: 'test-audience', ...payload })
  ).toString('base64url');
  return `${header}.${body}.fakesig`;
}

/** Create a server with stub auth that accepts any token starting with 'valid:'. */
function createTestServer(hookOverrides = {}) {
  const httpServer = http.createServer();

  const chatServer = createChatServer({
    httpServer,
    jwks: {
      // These won't be used — we override authenticateConnection
      url: 'https://example.com/.well-known/jwks.json',
      issuer: 'test-issuer',
      audience: 'test-audience',
    },
    cors: { origin: '*' },
    hooks: {
      // Stub auth: accept tokens in format "valid:<sub>:<tenantId>"
      // Reject everything else.
      authenticateConnection: async (_socket, token) => {
        if (!token || !token.startsWith('valid:')) {
          throw Object.assign(new Error('Authentication failed'), { data: 'AuthError' });
        }
        const [, sub, tenantId] = token.split(':');
        return { sub, tenantId: tenantId ?? 'tenant-1' };
      },
      // Default resolveRoom: always use tenantId prefix
      resolveRoom: async (user, roomRequest) => `${user.tenantId}:${roomRequest ?? 'general'}`,
      ...hookOverrides,
    },
  });

  return { httpServer, chatServer };
}

/** Connect a client to the server with a token. Returns the socket. */
function connectClient(port, token, options = {}) {
  return ioc(`http://127.0.0.1:${port}`, {
    auth: { token },
    transports: ['websocket'],
    ...options,
  });
}

/** Wait for a socket event once, with a timeout. */
function waitForEvent(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event "${event}"`));
    }, timeoutMs);

    socket.once(event, (...args) => {
      clearTimeout(timer);
      resolve(args.length === 1 ? args[0] : args);
    });
  });
}

/** Connect a socket and wait until it is connected (or fails). */
function waitForConnect(socket, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timeout waiting for connection'));
    }, timeoutMs);

    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('connect_error', (err) => { clearTimeout(timer); reject(err); });
  });
}

/** Start the http server on a random port, return the port. */
function startServer(httpServer) {
  return new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      resolve(httpServer.address().port);
    });
  });
}

/** Close the http server. */
function closeServer(httpServer) {
  return new Promise((resolve) => httpServer.close(resolve));
}

// ──────────────────────────────────────────────────────────────────────────────

describe('createChatServer — auth', () => {
  let httpServer, chatServer, port;
  const clients = [];

  before(async () => {
    ({ httpServer, chatServer } = createTestServer());
    port = await startServer(httpServer);
  });

  after(async () => {
    for (const c of clients) c.disconnect();
    chatServer.close();
    await closeServer(httpServer);
  });

  it('TEST 1: alg=none JWT → connect_error with auth error', async () => {
    // The stub auth rejects anything not starting with 'valid:'
    // A fake "alg=none" JWT won't start with "valid:" — it'll be rejected
    const badToken = fakeJwt('none');
    const client = connectClient(port, badToken);
    clients.push(client);

    const err = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No connect_error received')), 3000);
      client.once('connect_error', (e) => { clearTimeout(timer); resolve(e); });
      client.once('connect', () => { clearTimeout(timer); reject(new Error('Should not have connected')); });
    });

    assert.ok(err, 'Should have received a connect_error');
    assert.match(err.message, /authentication failed/i);
  });

  it('TEST 2: Valid JWT → connects and can join default room', async () => {
    const client = connectClient(port, 'valid:user-1:tenant-abc');
    clients.push(client);

    await waitForConnect(client);

    // Join a room
    const [err, roomId] = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('join ack timeout')), 3000);
      client.emit('join', { room: 'general' }, (e, r) => {
        clearTimeout(timer);
        resolve([e, r]);
      });
    });

    assert.equal(err, null, 'join should succeed');
    assert.equal(roomId, 'tenant-abc:general', 'room ID should be resolved by hook');
  });
});

describe('createChatServer — messaging', () => {
  let httpServer, chatServer, port;
  const clients = [];

  before(async () => {
    ({ httpServer, chatServer } = createTestServer());
    port = await startServer(httpServer);
  });

  after(async () => {
    for (const c of clients) c.disconnect();
    chatServer.close();
    await closeServer(httpServer);
  });

  it('TEST 3: Send message to room → all room members receive it', async () => {
    // Two clients join the same room
    const c1 = connectClient(port, 'valid:user-1:tenant-x');
    const c2 = connectClient(port, 'valid:user-2:tenant-x');
    clients.push(c1, c2);

    await waitForConnect(c1);
    await waitForConnect(c2);

    // Both join the same room
    await new Promise((resolve, reject) => {
      c1.emit('join', { room: 'support' }, (err) => err ? reject(err) : resolve());
    });
    await new Promise((resolve, reject) => {
      c2.emit('join', { room: 'support' }, (err) => err ? reject(err) : resolve());
    });

    // c2 listens for a message
    const messagePromise = waitForEvent(c2, 'message');

    // c1 sends a message
    const [sendErr] = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('send ack timeout')), 3000);
      c1.emit('message', { room: 'tenant-x:support', text: 'Hello!' }, (err, msg) => {
        clearTimeout(timer);
        resolve([err, msg]);
      });
    });

    assert.equal(sendErr, null, 'send should succeed');

    const received = await messagePromise;
    assert.equal(received.text, 'Hello!');
    assert.equal(received.from, 'user-1');
    assert.equal(received.roomId, 'tenant-x:support');
    assert.ok(received.id, 'message should have an id');
    assert.ok(received.timestamp, 'message should have a timestamp');
  });

  it('TEST 4: resolveRoom hook receives user context correctly', async () => {
    let capturedUser = null;
    let capturedRoomRequest = null;

    const { httpServer: hs2, chatServer: cs2 } = createTestServer({
      resolveRoom: async (user, roomRequest) => {
        capturedUser = user;
        capturedRoomRequest = roomRequest;
        return `captured:${roomRequest}`;
      },
    });

    const p2 = await startServer(hs2);

    const client = connectClient(p2, 'valid:user-99:tenant-99');
    clients.push(client);
    await waitForConnect(client);

    await new Promise((resolve, reject) => {
      client.emit('join', { room: 'my-room' }, (err) => err ? reject(new Error(err.message)) : resolve());
    });

    assert.ok(capturedUser, 'resolveRoom should have been called');
    assert.equal(capturedUser.sub, 'user-99');
    assert.equal(capturedUser.tenantId, 'tenant-99');
    assert.equal(capturedRoomRequest, 'my-room');

    client.disconnect();
    cs2.close();
    await closeServer(hs2);
  });
});

describe('createChatServer — presence', () => {
  let httpServer, chatServer, port;
  const clients = [];

  before(async () => {
    ({ httpServer, chatServer } = createTestServer());
    port = await startServer(httpServer);
  });

  after(async () => {
    for (const c of clients) c.disconnect();
    chatServer.close();
    await closeServer(httpServer);
  });

  it('TEST 5: User disconnect → presence event emitted to room', async () => {
    const c1 = connectClient(port, 'valid:user-a:tenant-p');
    const c2 = connectClient(port, 'valid:user-b:tenant-p');
    clients.push(c1);
    // c2 will disconnect — don't add to persistent list

    await waitForConnect(c1);
    await waitForConnect(c2);

    // Both join same room
    await new Promise((resolve, reject) => {
      c1.emit('join', { room: 'lobby' }, (err) => err ? reject(err) : resolve());
    });
    await new Promise((resolve, reject) => {
      c2.emit('join', { room: 'lobby' }, (err) => err ? reject(err) : resolve());
    });

    // c1 listens for presence event
    const presencePromise = waitForEvent(c1, 'presence');

    // c2 disconnects
    c2.disconnect();

    const presence = await presencePromise;
    assert.equal(presence.userId, 'user-b');
    assert.equal(presence.event, 'left');
    assert.equal(presence.roomId, 'tenant-p:lobby');
  });

  it('TEST 6: authorizeRoom returns false → error emitted, socket not in room', async () => {
    const { httpServer: hs3, chatServer: cs3 } = createTestServer({
      authorizeRoom: async (_user, roomId) => roomId !== 'tenant-z:forbidden',
    });

    const p3 = await startServer(hs3);
    const client = connectClient(p3, 'valid:user-z:tenant-z');
    await waitForConnect(client);

    // Try to join a forbidden room
    const [err, roomId] = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('join ack timeout')), 3000);
      client.emit('join', { room: 'forbidden' }, (e, r) => {
        clearTimeout(timer);
        resolve([e, r]);
      });
    });

    assert.ok(err, 'Should receive an error');
    assert.match(err.message, /access denied/i);
    assert.equal(roomId, null);

    // Verify the socket is NOT in the room
    const socketsInRoom = cs3.registry.getSocketsInRoom('tenant-z:forbidden');
    assert.equal(socketsInRoom.size, 0);

    client.disconnect();
    cs3.close();
    await closeServer(hs3);
  });
});
