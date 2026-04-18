/**
 * In-memory room registry.
 *
 * Tracks which users are in which rooms. This is the default implementation —
 * consumers can swap it out for a Redis-backed implementation via hooks for
 * multi-node deployments.
 *
 * Room state shape:
 *   rooms: Map<roomId, Set<socketId>>
 *   socketRooms: Map<socketId, Set<roomId>>    — reverse index for fast cleanup
 *   socketUsers: Map<socketId, object>          — user payload per socket
 */
export class RoomRegistry {
  constructor() {
    /** @type {Map<string, Set<string>>} roomId → Set of socketIds */
    this._rooms = new Map();

    /** @type {Map<string, Set<string>>} socketId → Set of roomIds */
    this._socketRooms = new Map();

    /** @type {Map<string, object>} socketId → user payload */
    this._socketUsers = new Map();
  }

  /**
   * Register a socket with its authenticated user.
   *
   * @param {string} socketId
   * @param {object} user - Verified JWT payload
   */
  registerSocket(socketId, user) {
    this._socketUsers.set(socketId, user);
    this._socketRooms.set(socketId, new Set());
  }

  /**
   * Add a socket to a room.
   *
   * @param {string} socketId
   * @param {string} roomId
   */
  joinRoom(socketId, roomId) {
    if (!this._rooms.has(roomId)) {
      this._rooms.set(roomId, new Set());
    }
    this._rooms.get(roomId).add(socketId);

    if (!this._socketRooms.has(socketId)) {
      this._socketRooms.set(socketId, new Set());
    }
    this._socketRooms.get(socketId).add(roomId);
  }

  /**
   * Remove a socket from a room.
   *
   * @param {string} socketId
   * @param {string} roomId
   */
  leaveRoom(socketId, roomId) {
    const roomSockets = this._rooms.get(roomId);
    if (roomSockets) {
      roomSockets.delete(socketId);
      if (roomSockets.size === 0) {
        this._rooms.delete(roomId);
      }
    }

    const socketRooms = this._socketRooms.get(socketId);
    if (socketRooms) {
      socketRooms.delete(roomId);
    }
  }

  /**
   * Remove a socket from all rooms and clean up its state.
   * Returns the set of roomIds the socket was in.
   *
   * @param {string} socketId
   * @returns {Set<string>} roomIds the socket was in
   */
  removeSocket(socketId) {
    const rooms = this._socketRooms.get(socketId) ?? new Set();

    for (const roomId of rooms) {
      const roomSockets = this._rooms.get(roomId);
      if (roomSockets) {
        roomSockets.delete(socketId);
        if (roomSockets.size === 0) {
          this._rooms.delete(roomId);
        }
      }
    }

    this._socketRooms.delete(socketId);
    this._socketUsers.delete(socketId);

    return rooms;
  }

  /**
   * Get all socket IDs in a room.
   *
   * @param {string} roomId
   * @returns {Set<string>}
   */
  getSocketsInRoom(roomId) {
    return this._rooms.get(roomId) ?? new Set();
  }

  /**
   * Get the user payload for a socket.
   *
   * @param {string} socketId
   * @returns {object|undefined}
   */
  getUser(socketId) {
    return this._socketUsers.get(socketId);
  }

  /**
   * Get all rooms a socket is in.
   *
   * @param {string} socketId
   * @returns {Set<string>}
   */
  getRoomsForSocket(socketId) {
    return this._socketRooms.get(socketId) ?? new Set();
  }

  /**
   * Check if a socket is registered (connected).
   *
   * @param {string} socketId
   * @returns {boolean}
   */
  hasSocket(socketId) {
    return this._socketUsers.has(socketId);
  }

  /**
   * Get total number of connected sockets.
   *
   * @returns {number}
   */
  get size() {
    return this._socketUsers.size;
  }
}
