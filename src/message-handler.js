/**
 * Message handler — routes incoming Socket.IO events to rooms and calls hooks.
 *
 * Handles:
 *   - 'message'  — send a chat message to a room
 *   - 'typing'   — broadcast typing indicator to a room
 *   - 'join'     — join a room (resolved + authorized via hooks)
 *   - 'leave'    — leave a room explicitly
 *
 * Events emitted to clients:
 *   - 'message'  — new chat message   { id, roomId, from, text, timestamp }
 *   - 'typing'   — typing indicator   { roomId, from, isTyping }
 *   - 'presence' — join/leave event   { roomId, userId, event: 'joined'|'left' }
 *   - 'error'    — error details      { message }
 */

import { randomUUID } from 'node:crypto';

/**
 * Build message payload.
 *
 * @param {string} roomId
 * @param {object} user   - Verified JWT payload (must have .sub)
 * @param {string} text
 * @returns {object}
 */
function buildMessage(roomId, user, text) {
  return {
    id: randomUUID(),
    roomId,
    from: user.sub,
    text: String(text),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Register all Socket.IO event listeners for a connected socket.
 *
 * @param {object} params
 * @param {import('socket.io').Socket}  params.socket
 * @param {import('socket.io').Server}  params.io
 * @param {object}                      params.user    - Verified JWT payload
 * @param {import('./room-registry.js').RoomRegistry} params.registry
 * @param {object}                      params.hooks   - Resolved hooks
 */
export function registerSocketHandlers({ socket, io, user, registry, hooks }) {
  /**
   * join — join a room.
   *
   * Payload: { room: <consumer-defined room request> }
   * Ack:     (err, roomId) — err is null on success
   */
  socket.on('join', async (payload, ack) => {
    const roomRequest = payload?.room ?? null;

    try {
      // Resolve the concrete room ID via the consumer hook
      const roomId = await hooks.resolveRoom(user, roomRequest);

      // Authorize
      const allowed = await hooks.authorizeRoom(user, roomId);
      if (!allowed) {
        const err = { message: `Access denied to room "${roomId}"` };
        if (typeof ack === 'function') ack(err, null);
        else socket.emit('error', err);
        return;
      }

      // Join the Socket.IO room AND the registry
      socket.join(roomId);
      registry.joinRoom(socket.id, roomId);

      // Presence event — notify others in the room
      socket.to(roomId).emit('presence', {
        roomId,
        userId: user.sub,
        event: 'joined',
      });

      await hooks.onUserJoin(user, roomId);

      if (typeof ack === 'function') ack(null, roomId);
    } catch (err) {
      const errPayload = { message: err.message ?? 'Failed to join room' };
      if (typeof ack === 'function') ack(errPayload, null);
      else socket.emit('error', errPayload);
    }
  });

  /**
   * leave — explicitly leave a room.
   *
   * Payload: { room: roomId }
   */
  socket.on('leave', async (payload) => {
    const roomId = payload?.room;
    if (!roomId) return;

    socket.leave(roomId);
    registry.leaveRoom(socket.id, roomId);

    socket.to(roomId).emit('presence', {
      roomId,
      userId: user.sub,
      event: 'left',
    });

    await hooks.onUserLeave(user, roomId);
  });

  /**
   * message — send a chat message to a room.
   *
   * Payload: { room: roomId, text: string }
   * Ack:     (err, msg) — err is null on success
   */
  socket.on('message', async (payload, ack) => {
    const roomId = payload?.room;
    const text = payload?.text;

    if (!roomId || typeof text !== 'string' || text.trim() === '') {
      const err = { message: 'Invalid message: room and non-empty text are required' };
      if (typeof ack === 'function') ack(err, null);
      else socket.emit('error', err);
      return;
    }

    // Only allow message to rooms the socket is actually in
    if (!registry.getRoomsForSocket(socket.id).has(roomId)) {
      const err = { message: `Not a member of room "${roomId}"` };
      if (typeof ack === 'function') ack(err, null);
      else socket.emit('error', err);
      return;
    }

    const msg = buildMessage(roomId, user, text.trim());

    // Broadcast to everyone in the room INCLUDING sender
    io.to(roomId).emit('message', msg);

    // Collect recipient socket IDs for the delivery hook
    const recipients = Array.from(registry.getSocketsInRoom(roomId));

    // Fire-and-forget hooks (errors are non-fatal for delivery)
    hooks.persistMessage(msg).catch(() => {});
    hooks.onMessageDelivered(msg, recipients).catch(() => {});

    if (typeof ack === 'function') ack(null, msg);
  });

  /**
   * typing — broadcast typing indicator to a room.
   *
   * Payload: { room: roomId, isTyping: boolean }
   */
  socket.on('typing', (payload) => {
    const roomId = payload?.room;
    const isTyping = Boolean(payload?.isTyping);

    if (!roomId) return;

    // Only propagate if the socket is actually in that room
    if (!registry.getRoomsForSocket(socket.id).has(roomId)) return;

    // Broadcast to others (not back to sender)
    socket.to(roomId).emit('typing', {
      roomId,
      from: user.sub,
      isTyping,
    });
  });
}
