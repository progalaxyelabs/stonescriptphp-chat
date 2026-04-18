# Changelog

All notable changes to `@progalaxyelabs/stonescriptphp-chat` will be documented in this file.

## [0.1.0] — 2026-04-18

### Added
- Initial release
- `createChatServer(options)` — attaches Socket.IO to any `http.Server`
- JWKS authentication middleware (RS256 / ES256 only, 60s clock skew)
- In-memory `RoomRegistry` — tracks room membership, swappable via hooks for Redis
- `message-handler` — routes `message`, `typing`, `join`, `leave` events
- Plugin hooks: `authenticateConnection`, `resolveRoom`, `authorizeRoom`, `persistMessage`, `onMessageDelivered`, `onUserJoin`, `onUserLeave`
- Client events: `message`, `typing`, `presence`, `error`
- `publish(roomId, msg)` — server-side push to a room
- Server-side `registry` introspection
- Full test suite (auth, room registry, plugin hooks, Socket.IO integration)
