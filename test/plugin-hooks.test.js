/**
 * Tests for plugin-hooks.js — default hook implementations and resolveHooks.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveHooks,
  defaultAuthorizeRoom,
  defaultPersistMessage,
  defaultOnMessageDelivered,
  defaultOnUserJoin,
  defaultOnUserLeave,
  defaultResolveRoom,
} from '../src/plugin-hooks.js';

describe('plugin-hooks.js — defaults', () => {
  it('defaultAuthorizeRoom allows all users', async () => {
    const result = await defaultAuthorizeRoom({ sub: 'user-1' }, 'any-room');
    assert.equal(result, true);
  });

  it('defaultPersistMessage is a no-op', async () => {
    await assert.doesNotReject(() => defaultPersistMessage({ id: '1', text: 'hi' }));
  });

  it('defaultOnMessageDelivered is a no-op', async () => {
    await assert.doesNotReject(() => defaultOnMessageDelivered({}, ['s1', 's2']));
  });

  it('defaultOnUserJoin is a no-op', async () => {
    await assert.doesNotReject(() => defaultOnUserJoin({ sub: 'user-1' }, 'room-a'));
  });

  it('defaultOnUserLeave is a no-op', async () => {
    await assert.doesNotReject(() => defaultOnUserLeave({ sub: 'user-1' }, 'room-a'));
  });

  it('defaultResolveRoom throws to remind consumer to provide it', async () => {
    await assert.rejects(
      () => defaultResolveRoom({ sub: 'user-1' }, 'room-request'),
      /hooks\.resolveRoom is required/
    );
  });
});

describe('resolveHooks', () => {
  const fakeVerifier = {
    verify: async (token) => {
      if (token === 'valid') return { sub: 'user-1' };
      throw Object.assign(new Error('Invalid token'), { status: 401 });
    },
  };

  it('uses default authenticateConnection when not overridden', async () => {
    const hooks = resolveHooks({}, fakeVerifier);
    const user = await hooks.authenticateConnection(null, 'valid');
    assert.deepEqual(user, { sub: 'user-1' });
  });

  it('default authenticateConnection propagates auth errors', async () => {
    const hooks = resolveHooks({}, fakeVerifier);
    await assert.rejects(
      () => hooks.authenticateConnection(null, 'bad-token'),
      (err) => {
        assert.equal(err.status, 401);
        return true;
      }
    );
  });

  it('overrides authenticateConnection when provided', async () => {
    const customAuth = async (_socket, _token) => ({ sub: 'custom-user' });
    const hooks = resolveHooks({ authenticateConnection: customAuth }, fakeVerifier);
    const user = await hooks.authenticateConnection(null, 'anything');
    assert.deepEqual(user, { sub: 'custom-user' });
  });

  it('uses defaultResolveRoom when resolveRoom not provided', async () => {
    const hooks = resolveHooks({}, fakeVerifier);
    await assert.rejects(() => hooks.resolveRoom({}, 'req'), /hooks\.resolveRoom is required/);
  });

  it('uses provided resolveRoom hook', async () => {
    const hooks = resolveHooks(
      { resolveRoom: async (user, req) => `${user.sub}:${req}` },
      fakeVerifier
    );
    const roomId = await hooks.resolveRoom({ sub: 'user-1' }, 'support');
    assert.equal(roomId, 'user-1:support');
  });

  it('uses defaultAuthorizeRoom when not overridden', async () => {
    const hooks = resolveHooks({}, fakeVerifier);
    const allowed = await hooks.authorizeRoom({ sub: 'user-1' }, 'any-room');
    assert.equal(allowed, true);
  });

  it('overrides authorizeRoom when provided', async () => {
    const hooks = resolveHooks(
      { authorizeRoom: async (_user, roomId) => roomId === 'allowed-room' },
      fakeVerifier
    );
    assert.equal(await hooks.authorizeRoom({}, 'allowed-room'), true);
    assert.equal(await hooks.authorizeRoom({}, 'forbidden-room'), false);
  });

  it('all optional hooks fall back to no-ops', async () => {
    const hooks = resolveHooks({}, fakeVerifier);
    await assert.doesNotReject(() => hooks.persistMessage({}));
    await assert.doesNotReject(() => hooks.onMessageDelivered({}, []));
    await assert.doesNotReject(() => hooks.onUserJoin({}, 'room'));
    await assert.doesNotReject(() => hooks.onUserLeave({}, 'room'));
  });
});
