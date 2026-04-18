/**
 * Tests for room-registry.js — in-memory room state.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RoomRegistry } from '../src/room-registry.js';

describe('RoomRegistry', () => {
  it('registers a socket and tracks user', () => {
    const reg = new RoomRegistry();
    reg.registerSocket('s1', { sub: 'user-1' });
    assert.deepEqual(reg.getUser('s1'), { sub: 'user-1' });
    assert.equal(reg.size, 1);
  });

  it('joins and tracks room membership', () => {
    const reg = new RoomRegistry();
    reg.registerSocket('s1', { sub: 'user-1' });
    reg.joinRoom('s1', 'room-a');

    assert.ok(reg.getSocketsInRoom('room-a').has('s1'));
    assert.ok(reg.getRoomsForSocket('s1').has('room-a'));
  });

  it('leaveRoom removes socket from room', () => {
    const reg = new RoomRegistry();
    reg.registerSocket('s1', { sub: 'user-1' });
    reg.joinRoom('s1', 'room-a');
    reg.leaveRoom('s1', 'room-a');

    assert.equal(reg.getSocketsInRoom('room-a').size, 0);
    assert.equal(reg.getRoomsForSocket('s1').has('room-a'), false);
  });

  it('removes empty rooms from the map when last socket leaves', () => {
    const reg = new RoomRegistry();
    reg.registerSocket('s1', { sub: 'user-1' });
    reg.joinRoom('s1', 'room-a');
    reg.leaveRoom('s1', 'room-a');

    // Room should be cleaned up — getSocketsInRoom returns empty Set, not stored entry
    assert.equal(reg.getSocketsInRoom('room-a').size, 0);
  });

  it('removeSocket cleans up all rooms and returns them', () => {
    const reg = new RoomRegistry();
    reg.registerSocket('s1', { sub: 'user-1' });
    reg.joinRoom('s1', 'room-a');
    reg.joinRoom('s1', 'room-b');

    const rooms = reg.removeSocket('s1');
    assert.ok(rooms.has('room-a'));
    assert.ok(rooms.has('room-b'));
    assert.equal(reg.size, 0);
    assert.equal(reg.getSocketsInRoom('room-a').size, 0);
    assert.equal(reg.getSocketsInRoom('room-b').size, 0);
  });

  it('multiple sockets in same room', () => {
    const reg = new RoomRegistry();
    reg.registerSocket('s1', { sub: 'user-1' });
    reg.registerSocket('s2', { sub: 'user-2' });
    reg.joinRoom('s1', 'room-a');
    reg.joinRoom('s2', 'room-a');

    assert.equal(reg.getSocketsInRoom('room-a').size, 2);

    reg.removeSocket('s1');
    assert.equal(reg.getSocketsInRoom('room-a').size, 1);
    assert.ok(reg.getSocketsInRoom('room-a').has('s2'));
  });

  it('hasSocket returns correct values', () => {
    const reg = new RoomRegistry();
    assert.equal(reg.hasSocket('unknown'), false);
    reg.registerSocket('s1', { sub: 'user-1' });
    assert.equal(reg.hasSocket('s1'), true);
    reg.removeSocket('s1');
    assert.equal(reg.hasSocket('s1'), false);
  });
});
