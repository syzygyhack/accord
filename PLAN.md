# accord — Video IRC

A modern, Discord-competitive chat platform built on IRC. Minimal moving parts, maximal feature set.

---

## Vision

Replace centralized platforms (Discord, Slack) with a self-hostable, federable system that feels modern but runs on proven infrastructure. IRC is the backbone — a 36-year-old protocol that already handles text chat, channels, presence, auth, and permissions. We add a modern client, file uploads, and voice/video.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                     accord Client (Svelte 5 / SvelteKit)       │
│                                                                │
│  ┌───────────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │  IRC Protocol     │  │  LiveKit SDK │  │  File Upload     │ │
│  │  (WebSocket)      │  │  (WebRTC)    │  │  (HTTP)          │ │
│  └────────┬──────────┘  └───────┬──────┘  └────────┬─────────┘ │
└───────────┼─────────────────────┼──────────────────┼───────────┘
            │                     │                  │
            │ WSS (IRC)           │ WSS+WebRTC       │ HTTPS
            │                     │                  │
┌───────────▼──────────┐  ┌───────▼────────┐  ┌──────▼──────────┐
│   Ergo IRC Server    │  │  LiveKit SFU   │  │  accord-files   │
│                      │  │                │  │  (HTTP upload   │
│  - Accounts (SASL)   │  │  - Voice rooms │  │   + storage)    │
│  - Channels          │  │  - Video       │  │                 │
│  - History (MySQL)   │  │  - Screen share│  │  MinIO / R2 /   │
│  - Always-on/bouncer │  │  - Built-in    │  │  local FS       │
│  - Read markers      │  │    TURN        │  │                 │
│  - Reactions         │  │  - Token auth  │  │                 │
│  - Message redaction │  │                │  │                 │
│  - WebSocket native  │  │                │  │                 │
│  - HTTP API          │  │                │  │                 │
└──────────────────────┘  └────────────────┘  └─────────────────┘
```

### Services

| Service | Purpose | Binary | Required |
|---------|---------|--------|----------|
| **Ergo** | IRC server (text, auth, channels, history, presence) | Single Go binary | Yes |
| **LiveKit** | Voice/video SFU with built-in TURN + signaling | Single Go binary | Only for voice/video |
| **accord-files** | File uploads, auth bridge, server config, push relay | Custom (small) | Yes |
| **Caddy** | Reverse proxy, auto-TLS, static file serving | Single Go binary | Production only |
| **MySQL/MariaDB** | Persistent message history + push notification source | Standard | Required for push; recommended otherwise |

Minimum viable deployment: **Ergo + accord-files** (2 processes). Full deployment: 5 processes. This is honest — "3 services" undercounted it. But every piece is a single binary or standard Docker image, no custom orchestration needed.

The **accord-files** service handles:
1. **Auth bridge** — validates IRC credentials via Ergo HTTP API, issues short-lived JWTs for HTTP services (uploads, LiveKit, push)
2. **File uploads** — accept file, store to disk/S3/R2, return URL
3. **LiveKit token generation** — given a valid accord-files JWT, issue a LiveKit room token
4. **Server config endpoint** — serves `/.well-known/accord.json` (branding, roles, emoji, theme)
5. **Push relay** — polls Ergo's MySQL history table for new messages, sends Web Push notifications to idle devices
6. **URL metadata** — Open Graph scraping for link previews (optional)

---

## Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **IRC Server** | Ergo v2.17+ | Single binary. Built-in accounts, history, bouncer, ChanServ, WebSocket, HTTP API. Most complete IRCv3 implementation. |
| **Voice/Video** | LiveKit | Single binary SFU. Built-in TURN, signaling, room management, token auth. Client SDKs for JS, mobile. |
| **Client Framework** | Svelte 5 + SvelteKit | ~10KB runtime. Built-in reactivity (runes). Compiles away. Fastest DX for real-time UI. |
| **IRC in Browser** | Custom thin layer (~300 lines TS) over native WebSocket | Direct WSS to Ergo. Parse with `irc-message-ts`. No middleware needed. |
| **Desktop App** | Tauri 2.0 | 2.5MB bundle vs Electron's 100MB. 30MB RAM vs 200MB. Native on Win/Mac/Linux. Mobile support via Tauri 2.0. |
| **File Storage** | MinIO (self-hosted) or Cloudflare R2 (hosted) | S3-compatible. Presigned URLs = client uploads direct, bypasses server. |
| **Database** | SQLite (Ergo built-in) + MySQL/MariaDB (persistent history) | Ergo handles its own storage. MySQL only needed for history surviving restarts. |
| **Notifications** | Web Push (VAPID) + Service Worker | Works on all platforms including iOS 16.4+. No Firebase dependency. |

---

## IRC Protocol Features We Use

Ergo + IRCv3 give us these out of the box — no custom protocol work needed:

| Feature | IRCv3 Mechanism | Status | Ergo Support |
|---------|----------------|--------|-------------|
| **Accounts & Auth** | SASL (PLAIN, EXTERNAL, SCRAM-SHA-256) | Ratified | Yes |
| **Message History** | `draft/chathistory` — paginated server-side history | Draft | Yes |
| **Replies** | `+draft/reply` tag referencing parent `msgid` | Draft | Yes |
| **Reactions** | `+draft/react` tag via TAGMSG (persisted in history) | Draft | Yes |
| **Typing Indicators** | `+typing` tag via TAGMSG (ephemeral, not stored) | Draft | Yes |
| **Read Markers** | `draft/read-marker` — `MARKREAD` command, synced across devices | Draft | Yes |
| **Message Deletion** | `draft/message-redaction` — `REDACT` command | Draft | Yes |
| **Multi-line Messages** | `draft/multiline` — batch-based, up to 4096 bytes | Draft | Yes |
| **Online/Offline** | `MONITOR` + `away-notify` | Ratified | Yes |
| **User Identity** | `account-tag` + `account-notify` + `extended-join` | Ratified | Yes |
| **WebSocket** | IRCv3 WebSocket spec, `text.ircv3.net` subprotocol | Draft | Yes (native) |
| **Roles/Perms** | Channel modes: ~q (founder), &a (admin), @o (op), %h (halfop), +v (voice) | Core IRC | Yes |
| **Channel Mgmt** | Built-in ChanServ, auditorium mode (+u), op-moderated (+U) | Ergo | Yes |

### What We Must Build Ourselves

| Feature | Approach | See Section |
|---------|----------|-------------|
| **Auth Bridge** | Client authenticates via accord-files (`POST /api/auth`), which validates against Ergo's HTTP API and issues a short-lived JWT. All HTTP endpoints require this token. | Auth Bridge |
| **Message Editing** | `REDACT` original + new PRIVMSG with `+accord/edit=<original-msgid>` tag. Client maintains msgid mapping so replies/reactions track correctly. Non-accord clients see delete + new message. | Message Editing Semantics |
| **File Uploads** | Authenticated upload to accord-files → stored in S3/R2/local → URL posted as message. Client renders inline previews. | Auth Bridge (endpoints) |
| **Voice/Video** | LiveKit SFU for all calls (group and 1-on-1). accord-files issues LiveKit JWTs. Voice channels identified via `/.well-known/accord.json` config. | Voice/Video Architecture |
| **Server Config** | `/.well-known/accord.json` endpoint on accord-files. Single canonical source for branding, roles, emoji, categories, theme. Cached by client. | Server Config Discovery |
| **Threads** | `+draft/reply` is flat (one level). Client groups all replies to same parent into a thread view. Deeper nesting is UI-only. | — |
| **Rich Previews** | accord-files endpoint (`GET /api/preview?url=...`) fetches Open Graph metadata. Client-side fallback for simple URL detection. | — |
| **Custom Emoji** | Served from `/.well-known/accord.json` emoji map. Assets hosted by accord-files. Client renders in emoji picker and message display. | Server Config Discovery |
| **User Profiles/Avatars** | HTTP REST via accord-files (`GET/PUT /api/profile`, `POST /api/profile/avatar`). Profiles stored as JSON on server. Client caches reactively with deduplication. Ed25519 signed profile blobs planned for v2 (portable cross-server identity). | — |
| **Search** | Index from MySQL history table, or build a lightweight search endpoint in accord-files. | — |
| **Push Notifications** | MySQL history polling + device heartbeat idle detection. Push only when ALL devices idle. v1: DMs only. v2: channel @mentions. | Push Notification Pipeline |
| **Invite Links** | accord-files manages invite tokens. URL format: `https://accord.app/join/<server>/<token>`. Auto-join target channel on accept. | Invite Link System |

---

## Auth Bridge (IRC Session → HTTP Token)

The core trust problem: a browser has an IRC WebSocket connection (authenticated via SASL), but needs to call HTTP endpoints (file upload, LiveKit tokens, push registration). The IRC connection has no HTTP session. We solve this with a token-minting flow through Ergo's HTTP API.

### Flow

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│  accord Client │       │ accord-files   │         │  Ergo API   │
│  (browser)   │         │ (HTTP)       │         │  (port 8089)│
└──────┬──────┘         └──────┬──────┘         └──────┬──────┘
       │                       │                       │
       │ 1. POST /api/auth     │                       │
       │   {account, password} │                       │
       │──────────────────────>│                       │
       │                       │ 2. POST /v1/check_auth│
       │                       │   {account, password} │
       │                       │──────────────────────>│
       │                       │                       │
       │                       │ 3. {success: true}    │
       │                       │<──────────────────────│
       │                       │                       │
       │ 4. {token: "eyJ..."}  │                       │
       │   (short-lived JWT)   │                       │
       │<──────────────────────│                       │
       │                       │                       │
       │ 5. POST /api/upload   │                       │
       │   Authorization:      │                       │
       │   Bearer eyJ...       │                       │
       │──────────────────────>│                       │
```

### Token Specification

```
JWT payload:
{
  "sub": "accountname",          // Ergo account name
  "iss": "accord-files",           // Issuer
  "iat": 1706000000,             // Issued at
  "exp": 1706003600,             // Expires: 1 hour
  "srv": "accord.example.com"      // Ergo server this token is valid for
}

Signed with: HMAC-SHA256 (shared secret between accord-files instances)
```

### Token Lifecycle

1. **Minting**: Client sends account + password to `POST /api/auth`. accord-files validates against Ergo's `/v1/check_auth`. If valid, returns a JWT.
2. **Usage**: Client includes `Authorization: Bearer <token>` on all HTTP requests to accord-files (uploads, LiveKit tokens, push registration, config).
3. **Renewal**: Client refreshes the token before expiry by re-authenticating. The IRC connection's SASL credentials are already stored in client memory.
4. **Revocation**: Tokens are short-lived (1 hour). No revocation list needed. If an account is disabled in Ergo, the next auth attempt fails.

### Why Not EXTJWT?

Ergo supports EXTJWT (server-issued JWTs for external services). We could use this instead — the client requests a JWT from Ergo via the IRC connection, then presents it to accord-files. This is cleaner but adds complexity to the IRC protocol layer. Decision: **start with password-based auth bridge (simpler), migrate to EXTJWT later if needed.** Both paths are viable.

### Endpoints Protected by Auth

| Endpoint | Purpose | Auth Required |
|----------|---------|---------------|
| `POST /api/auth` | Mint a token | No (this IS the auth endpoint) |
| `POST /api/upload` | Upload a file | Yes |
| `POST /api/livekit/token` | Get LiveKit room JWT | Yes |
| `POST /api/push/subscribe` | Register push subscription | Yes |
| `POST /api/push/unsubscribe` | Remove push subscription | Yes |
| `GET /.well-known/accord.json` | Server config (branding, theme, emoji) | No (public) |
| `GET /api/preview?url=...` | URL metadata for link previews | Yes (rate-limited) |

---

## Server Config Discovery

All server-owner customization is served from a single discoverable endpoint. The client fetches this on first connection and caches it.

### Endpoint

```
GET https://accord.example.com/.well-known/accord.json
```

No authentication required. Cached by client with `ETag` / `If-None-Match` for efficient updates.

### Schema

```json
{
  "$schema": "https://accord.app/schema/server-config-v1.json",
  "version": 1,
  "name": "My Community",
  "icon": "/api/files/server-icon.png",
  "description": "A place for cool people",
  "motd": "Welcome! Read #rules before posting.",

  "theme": {
    "accent": "#e05050",
    "surfaces": {
      "lowest": "#1a1015",
      "low": "#201520",
      "base": "#281a28"
    }
  },

  "roles": {
    "~": { "name": "Owner",     "color": "#e0a040" },
    "&": { "name": "Admin",     "color": "#e05050" },
    "@": { "name": "Moderator", "color": "#50a0e0" },
    "%": { "name": "Helper",    "color": "#50e0a0" },
    "+": { "name": "Member",    "color": null }
  },

  "channels": {
    "categories": [
      {
        "name": "Text Channels",
        "channels": ["#general", "#dev", "#help", "#off-topic"]
      },
      {
        "name": "Voice Channels",
        "channels": ["#voice-lobby", "#voice-gaming"],
        "voice": true
      },
      {
        "name": "Info",
        "channels": ["#rules", "#welcome"],
        "readonly": true
      }
    ]
  },

  "emoji": {
    "catjam": "/api/files/emoji/catjam.gif",
    "pepethink": "/api/files/emoji/pepethink.png"
  },

  "welcome": {
    "message": "Welcome to My Community! Check out #rules first.",
    "suggested_channels": ["#rules", "#introductions", "#general"]
  },

  "invites": {
    "default_expiry": "7d",
    "max_uses": 0
  }
}
```

### What's Decorative vs Enforced

This is critical — the client must never pretend to enforce something IRC doesn't.

| Config Property | Enforced By | Notes |
|----------------|-------------|-------|
| `roles.*.name` | **Client only (decorative)** | Friendly names for IRC mode prefixes. IRC enforces the actual modes. |
| `roles.*.color` | **Client only (decorative)** | Visual only. Other IRC clients won't see role colors. |
| `channels.categories` | **Client only (decorative)** | IRC has no concept of categories. Client groups channels visually. |
| `channels.*.voice` | **Client convention** | accord clients treat these as voice channels. IRC sees them as normal channels. |
| `channels.*.readonly` | **IRC enforced** | Maps to channel mode `+m` (moderated). Ergo enforces this. |
| `theme` | **Client only** | CSS overrides. No server enforcement. |
| `emoji` | **Client only** | Custom rendering. Other IRC clients see `:catjam:` as text. |
| `welcome` | **Client only** | Shown by accord client on first join. |
| Kick / Ban / Mute | **IRC enforced** | These map to real IRC commands. Ergo enforces them. |
| Channel topic | **IRC enforced** | `/TOPIC` is a real IRC command. |
| Slow mode | **IRC enforced** | Maps to Ergo's per-channel rate limiting. |
| File size limits | **accord-files enforced** | HTTP service rejects oversized uploads. |

**Rule**: If the UI shows a setting toggle, it must be clear whether it's enforced (server rejects violations) or decorative (client-side cosmetic). The settings UI labels decorative options as "Display" and enforced options as "Permission".

---

## Push Notification Pipeline

### The Problem

Ergo's always-on mode keeps users "connected" even when no client is attached. IRC has no concept of "this user's phone screen is off." We need a separate device-awareness layer.

### Architecture

The push relay **polls Ergo's MySQL history table** for new messages. This is the only approach that works without modifying Ergo — IRC's `MONITOR` command only reports online/offline state, not message content. An IRC bot cannot observe DMs sent to other users or channel messages without joining every channel.

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│  accord Client │    │  accord-files      │     │  Ergo MySQL  │
│  (browser)    │     │  (push relay)    │     │  (history DB)│
└──────┬───────┘     └──────┬──────────┘     └──────┬───────┘
       │                    │                        │
       │ Register push sub  │                        │
       │───────────────────>│                        │
       │                    │ Store: {account,       │
       │                    │  endpoint, keys,       │
       │                    │  device_id}            │
       │                    │                        │
       │ Heartbeat every 5m │                        │
       │───────────────────>│                        │
       │                    │ Mark device "active"   │
       │                    │                        │
       │  [tab closed]      │                        │
       │                    │ No heartbeat for 10m   │
       │                    │ Mark device "idle"     │
       │                    │                        │
       │                    │ Poll every 5s:         │
       │                    │ SELECT new messages    │
       │                    │ WHERE target IN        │
       │                    │ (subscribed accounts)  │
       │                    │──────────────────────>│
       │                    │                        │
       │                    │ New DM or @mention     │
       │                    │<──────────────────────│
       │                    │                        │
       │                    │ Check: any device      │
       │                    │ active for this user?  │
       │                    │ → No → Send Web Push   │
       │                    │                        │
       │  <push arrives>    │                        │
       │<───────────────────│                        │
```

### Why MySQL Polling (Not an IRC Bot)

| Approach | Problem |
|----------|---------|
| IRC `MONITOR` | Only reports online/offline state. Cannot observe message content. |
| IRC bot in channels | Would need to join every channel. Doesn't see DMs to other users. |
| Ergo auth-script hook | Auth scripts run on login, not on message send. |
| Ergo HTTP API polling | No endpoint for "messages since timestamp." |
| **MySQL polling** | **Ergo writes all history to MySQL. We read it directly. Works for DMs and channel messages.** |

This makes MySQL a **hard requirement** for push notifications (not just "recommended"). Without MySQL, push doesn't work. This is acceptable — any server that wants push also wants persistent history.

### Device Model

```
push_subscriptions table:
  account       TEXT     -- Ergo account name
  device_id     TEXT     -- Client-generated UUID (persisted in localStorage)
  endpoint      TEXT     -- Web Push endpoint URL
  p256dh        TEXT     -- Client public key
  auth          TEXT     -- Client auth secret
  last_active   INTEGER  -- Unix timestamp of last heartbeat
  created_at    INTEGER

push_cursor table:
  id            INTEGER  -- singleton row
  last_msgid    TEXT     -- last processed message ID from history table
```

- **Active device**: `last_active` within the last 10 minutes
- **Idle device**: `last_active` older than 10 minutes
- **Push trigger**: A DM arrives for an account where ALL registered devices are idle

### Poll Loop

accord-files runs a background goroutine that:
1. Every 5 seconds: `SELECT * FROM history WHERE msgid > last_msgid ORDER BY msgid LIMIT 100`
2. For each message: check if target account has push subscriptions AND all devices are idle
3. If yes: send Web Push notification
4. Update `last_msgid` cursor
5. DMs: target is the recipient account name
6. Channel @mentions: scan message text for `@accountname` patterns (v2 — see below)

### What Triggers a Push (v1)

| Event | Push? | Notes |
|-------|-------|-------|
| DM received | Yes (if all devices idle) | Target is clear from history table |
| @mention in channel | **No (v2)** | Requires parsing message content for @patterns. Deferred. |
| @here / @everyone | **No (v2)** | Same parsing problem. Deferred. |
| Regular channel message | No | — |
| Reaction on your message | No | — |

**v1 scope is DMs only.** This is simple, correct, and useful. Channel mention push requires message content parsing and is deferred to v2.

---

## Message Editing Semantics

### The Problem

No IRCv3 spec for editing exists. Our REDACT + resend approach creates a new `msgid`, which breaks reply chains, read markers, and reaction associations pointed at the original.

### Solution: Tombstone + Edit Pointer

```
1. User sends original message:
   S: @msgid=ORIG123 :alice!u@h PRIVMSG #general :Hello wrold

2. User edits the message. Client sends:
   a. REDACT #general ORIG123              ← tombstone the original
   b. @+accord/edit=ORIG123 PRIVMSG #general :Hello world  ← new message with edit tag

3. Server assigns new msgid:
   S: @msgid=EDIT456;+accord/edit=ORIG123 :alice!u@h PRIVMSG #general :Hello world
```

### Client Behavior

- When receiving a message with `+accord/edit=<original-msgid>`:
  1. Find the original message in the buffer by `ORIG123`
  2. Replace its content with the new text
  3. Keep its original position in the message list
  4. Show "(edited)" indicator
  5. Store mapping: `ORIG123 → EDIT456` (the edit chain)
- Replies, reactions, and read markers that reference `ORIG123` continue to work because the client maintains the mapping
- If a reply points to a redacted `msgid` that has no edit mapping, show "[original message deleted]"

### Non-accord Clients

- Standard IRC clients will see: the original message disappear (REDACT) and a new message appear at the bottom. This is acceptable — they don't support editing anyway.
- The `+accord/edit` tag is a client-only tag (prefixed with `+`), so it's safe to send through any IRC server. Servers that don't understand it will ignore and relay it.

### Edit Limitations

- Only the message author can edit (client enforces; also, only the author can REDACT their own message)
- Edits within 15 minutes of sending (client-side enforced; configurable)
- Edit history is not preserved (only latest version shown). Future: store edit chain for audit.

---

## Invite Link System

IRC has no native invite links. We build this in accord-files.

### URL Format

```
https://accord.app/join/chat.mycommunity.com/abc123def
                        │                    │
                        server hostname      invite token
```

### Flow

1. **Server admin creates invite** via settings UI or `/invite create #channel`
2. accord-files generates a random token, stores it:
   ```
   invites table:
     token       TEXT     -- random 12-char alphanumeric
     server      TEXT     -- Ergo server hostname
     channel     TEXT     -- target channel (e.g., #general)
     created_by  TEXT     -- account name of creator
     expires_at  INTEGER  -- Unix timestamp (0 = never)
     max_uses    INTEGER  -- 0 = unlimited
     use_count   INTEGER  -- current uses
   ```
3. **User clicks invite link** → accord.app (or desktop client) opens
4. Client extracts server hostname + token from URL
5. Client connects to the Ergo server via WebSocket
6. If user has no account → registration flow
7. Client calls `GET /api/invite/abc123def` on accord-files → gets `{channel: "#general", server: "chat.mycommunity.com"}`
8. Client auto-joins the channel

### Invite Validation

- accord-files checks: token exists, not expired, use_count < max_uses
- If valid: increment use_count, return channel info
- If invalid: return error (expired, max uses reached, not found)

---

## Voice/Video Architecture

### How It Works

1. **Voice channels** are regular IRC channels listed in the `voice` category of `/.well-known/accord.json`. This is the sole source of truth — no channel modes, topic prefixes, or naming conventions are used for detection.
2. When a user joins a voice channel in the accord client:
   - The client requests a **LiveKit JWT token** from accord-files (authenticated via IRC session)
   - The token grants access to a LiveKit room matching the channel name
   - The client connects via `livekit-client` SDK and enables microphone
3. IRC handles presence (who's in the channel). LiveKit handles media (audio/video streams).
4. **1-on-1 calls**: Route through LiveKit (same as group calls). P2P via IRC signaling is NOT viable — SDP/ICE payloads are too large for TAGMSG tags (~4KB limit). Using LiveKit for all calls keeps the architecture simple and consistent.
5. **Screen sharing**: Native WebRTC `getDisplayMedia()`, just another track through LiveKit

### Resource Requirements

| Scale | Concurrent Voice Users | Server Spec | Est. Cost |
|-------|----------------------|-------------|-----------|
| Small community | 10 | 2-core, 4GB RAM | $10-20/mo |
| Medium | 50 | 4-core, 8GB RAM | $40-80/mo |
| Large | 100 | 8-core, 16GB RAM | $80-150/mo |

Audio is cheap (~3 kbps/user). A 10-person voice channel = ~270 kbps total outbound. Video is 100-1000x more expensive.

---

## Client Architecture

```
accord-client/
├── src/
│   ├── lib/
│   │   ├── irc/
│   │   │   ├── connection.ts      # WebSocket → Ergo, IRC line send/recv
│   │   │   ├── parser.ts          # IRC message parsing (or use irc-message-ts)
│   │   │   ├── cap.ts             # CAP negotiation (request all IRCv3 caps)
│   │   │   ├── sasl.ts            # SASL authentication
│   │   │   ├── history.ts         # CHATHISTORY pagination logic
│   │   │   └── state.svelte.ts    # Reactive IRC state (channels, users, messages)
│   │   ├── voice/
│   │   │   ├── room.ts            # LiveKit room management
│   │   │   └── state.svelte.ts    # Voice state (participants, mute, deafen)
│   │   ├── files/
│   │   │   ├── upload.ts          # Presigned URL upload flow
│   │   │   └── preview.ts         # URL unfurling / media preview
│   │   └── notifications/
│   │       ├── push.ts            # Web Push subscription
│   │       └── sw.ts              # Service Worker
│   ├── routes/
│   │   ├── +layout.svelte         # App shell (server list, channel sidebar)
│   │   ├── /[server]/
│   │   │   ├── +layout.svelte     # Server layout (channel list)
│   │   │   └── /[channel]/
│   │   │       └── +page.svelte   # Chat view (messages, input, voice panel)
│   └── components/
│       ├── MessageList.svelte      # Virtual-scrolled message list
│       ├── Message.svelte          # Single message (formatting, reactions, replies)
│       ├── MessageInput.svelte     # Rich input (markdown, file drag-drop, emoji picker)
│       ├── ChannelSidebar.svelte   # Channel list + voice channel indicators
│       ├── UserList.svelte         # Member list with roles, presence
│       ├── VoicePanel.svelte       # Voice channel controls (mute, deafen, disconnect)
│       └── ThreadView.svelte       # Thread sidebar (grouped replies)
├── static/
├── tauri/                          # Tauri desktop wrapper config
├── svelte.config.js
├── vite.config.ts
└── package.json
```

### Key Client Behaviors

**Connection flow:**
1. Open WebSocket to `wss://ergo.example.com`
2. `CAP LS 302` → Request all needed caps (chathistory, message-tags, echo-message, labeled-response, batch, server-time, sasl, draft/read-marker, etc.)
3. SASL PLAIN authentication
4. `CAP END` → Join channels
5. For each channel: `CHATHISTORY LATEST #channel * 50` → populate backlog
6. `MARKREAD #channel` → get read position, show unread divider
7. Subscribe to typing, reactions, redactions via TAGMSG

**Message rendering:**
- Parse mIRC formatting codes (bold, italic, underline, color, monospace)
- Detect URLs → render inline previews (images, videos, links)
- Detect `+draft/reply` → render as reply with quoted parent
- Detect `+draft/react` → aggregate into reaction badges under message
- Detect accord file URLs → render as embedded media
- Convert markdown-like input syntax to mIRC formatting codes on send (see FRONTEND.md: Formatting Strategy)

**Virtual scrolling:**
- Render only visible messages (~50 at a time)
- Scroll up → `CHATHISTORY BEFORE #channel msgid=<oldest> 50` → prepend
- Anchor to bottom by default, with "new messages" jump button

---

## Phased Roadmap

### Phase 0 — Foundation (Weeks 1-2)
- [ ] Set up monorepo structure
- [ ] Deploy Ergo with accounts, history, WebSocket, TLS
- [ ] Build IRC protocol layer in TypeScript (connection, parser, CAP, SASL)
- [ ] Basic SvelteKit app shell connecting to Ergo via WebSocket
- [ ] Login/register screen (SASL auth against Ergo accounts)
- [ ] Channel join, send/receive PRIVMSG
- [ ] **Milestone: Text chat works in a browser**

### Phase 1 — Core Chat UX (Weeks 3-5)
- [ ] Message history (CHATHISTORY pagination + virtual scroll)
- [ ] Read markers (MARKREAD — unread badges, "new messages" divider)
- [ ] Replies (+draft/reply — inline reply UI + thread grouping)
- [ ] Reactions (+draft/react — emoji picker, reaction badges)
- [ ] Typing indicators (+typing — "user is typing..." below input)
- [ ] Message deletion (REDACT — with confirmation dialog)
- [ ] Message editing (REDACT + resend with +accord/edit tag)
- [ ] mIRC formatting rendering (bold, italic, color, monospace)
- [ ] User list with roles (render channel mode prefixes as named roles)
- [ ] Channel topic display and editing
- [ ] **Milestone: Chat feature parity with Discord text channels**

### Phase 2 — Media & Files (Weeks 6-7)
- [ ] Build accord-files service (file upload endpoint + storage)
- [ ] Drag-and-drop file upload in message input
- [ ] Image/video inline preview rendering
- [ ] URL unfurling (Open Graph previews for links)
- [ ] Paste-to-upload (clipboard images)
- [ ] File size limits and type restrictions
- [ ] **Milestone: File sharing works**

### Phase 3 — Voice & Video (Weeks 8-10)
- [ ] Deploy LiveKit alongside Ergo
- [ ] Build token bridge in accord-files (IRC session → LiveKit JWT)
- [ ] Voice channel detection (from `/.well-known/accord.json` voice category)
- [ ] Join/leave voice channel UI
- [ ] Mute/deafen/volume controls
- [ ] Voice activity indicators (who's speaking)
- [ ] Video toggle (camera on/off)
- [ ] Screen sharing
- [ ] 1-on-1 calls via LiveKit (same infrastructure as group calls)
- [ ] **Milestone: Voice/video channels work**

### Phase 4 — Polish & Platform (Weeks 11-14)
- [ ] Push notifications (Web Push via VAPID — browser-local notifications already work)
- [x] PWA support (manifest.json, offline shell, installable)
- [x] Tauri desktop wrapper (Windows, macOS, Linux)
- [x] Server/community management UI (ServerSettings, channel creation, permissions, bans)
- [x] Invite links (`https://accord.app/join/<server>/<token>` — see Invite Link System)
- [x] User profiles (avatar, bio, status via accord-files REST API)
- [x] Custom emoji system (server-defined emoji name→URL map)
- [ ] Search (full-text over message history)
- [x] DM conversations
- [ ] Multi-server support (connect to multiple Ergo instances)
- [ ] **Milestone: Shippable product**

### Phase 5 — Scale & Ecosystem (Ongoing)
- [ ] Tauri mobile (iOS, Android via Tauri 2.0)
- [ ] Bot framework (IRC bots with accord-aware conventions)
- [ ] Webhook integrations (GitHub, CI, monitoring → IRC channel)
- [ ] E2EE for DMs (key exchange over DM, encrypt message bodies)
- [ ] Federation considerations (if Ergo adds clustering)
- [ ] Theming system (user-selectable themes)
- [ ] Plugin API for client-side extensions

---

## Deployment

### Development (single machine)

```bash
# 1. Ergo
./ergo run --conf ircd.yaml

# 2. LiveKit
livekit-server --dev

# 3. accord-files
./accord-files --config files.yaml

# 4. Client
npm run dev
```

### Production (docker-compose)

```yaml
version: '3.8'
services:
  ergo:
    image: ghcr.io/ergochat/ergo:stable
    ports:
      - "6697:6697"     # IRC TLS
      - "8097:8097"     # WebSocket TLS
    volumes:
      - ./ergo/ircd.yaml:/ircd/ircd.yaml
      - ergo-data:/ircd/db

  livekit:
    image: livekit/livekit-server:latest
    ports:
      - "7880:7880"     # API + signaling
      - "7881:7881"     # RTC TCP
      - "50000-50100:50000-50100/udp"  # RTC UDP
    volumes:
      - ./livekit/config.yaml:/etc/livekit.yaml
    command: --config /etc/livekit.yaml

  accord-files:
    build: ./accord-files
    ports:
      - "8080:8080"
    environment:
      - ERGO_API=http://ergo:8089
      - LIVEKIT_URL=ws://livekit:7880
      - LIVEKIT_API_KEY=mykey
      - LIVEKIT_API_SECRET=mysecret
      - STORAGE_PATH=/data/uploads

  mysql:
    image: mariadb:11
    environment:
      MYSQL_ROOT_PASSWORD: changeme
      MYSQL_DATABASE: ergo_history
    volumes:
      - mysql-data:/var/lib/mysql

  caddy:
    image: caddy:2
    ports:
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - ./accord-client/build:/srv/accord  # Built client static files

volumes:
  ergo-data:
  mysql-data:
```

### Caddyfile

```
accord.example.com {
    # Server config discovery (must be before file_server)
    reverse_proxy /.well-known/accord.json accord-files:8080

    # IRC WebSocket
    reverse_proxy /irc/* ergo:8097

    # LiveKit
    reverse_proxy /livekit/* livekit:7880

    # File uploads, auth bridge, invites, push, previews
    reverse_proxy /api/* accord-files:8080

    # Static client files (fallback)
    root * /srv/accord
    file_server
}
```

---

## Ergo Configuration (Key Settings)

```yaml
server:
    name: accord.example.com
    listeners:
        ":6697":
            tls:
                cert: /certs/fullchain.pem
                key: /certs/privkey.pem
        ":8097":
            websocket: true
            tls:
                cert: /certs/fullchain.pem
                key: /certs/privkey.pem

accounts:
    registration:
        enabled: true
        allow-before-connect: true
    authentication-enabled: true
    multiclient:
        enabled: true
        allowed-by-default: true
        always-on: opt-out       # Users stay connected even when no clients attached
    nick-reservation:
        enabled: true
        method: strict           # Nick must equal account name (Discord-like)
        force-nick-equals-account: true

channels:
    registration:
        enabled: true

history:
    enabled: true
    channel-length: 4096
    client-length: 512
    chathistory-maxmessages: 1000
    retention:
        allow-individual-delete: true
    tagmsg-storage:
        default: false
        whitelist:
            - "+draft/react"
            - "+react"

api:
    enabled: true
    listener: "127.0.0.1:8089"
```

---

## Competitive Analysis: What accord Gets You vs Discord

| Feature | Discord | accord |
|---------|---------|------|
| Text chat | Yes | Yes (IRC) |
| Message history | Yes (limited on free) | Yes (unlimited, self-hosted) |
| Reactions | Yes | Yes (IRCv3) |
| Replies/threads | Yes | Yes (IRCv3 + client) |
| Typing indicators | Yes | Yes (IRCv3) |
| Read receipts | Yes | Yes (IRCv3) |
| Message edit/delete | Yes | Yes (custom + IRCv3) |
| File uploads | Yes | Yes (accord-files) |
| Voice channels | Yes | Yes (LiveKit) |
| Video | Yes | Yes (LiveKit) |
| Screen share | Yes | Yes (WebRTC native) |
| Roles/permissions | Yes | Yes (IRC modes) |
| Self-hostable | No | **Yes** |
| Data ownership | No | **Yes** |
| No telemetry | No | **Yes** |
| Federable | No | **Possible** (IRC linking) |
| Open protocol | No | **Yes** (IRC + IRCv3) |
| Interoperable | No | **Yes** (any IRC client can connect) |
| Free, no limits | Nitro/$$$  | **Yes** |

---

## Scalability Limits (Honest Assessment)

| Metric | Comfortable Limit | Hard Limit | Path Forward |
|--------|-------------------|------------|-------------|
| Concurrent text users | 10,000 | ~50,000 (vertical scaling) | Ergo clustering (planned, not yet implemented) |
| Users per channel | 2,000 | ~5,000 | Ergo clustering |
| Concurrent voice users | 100 per LiveKit node | 500+ with multi-node | LiveKit multi-node (Redis) |
| Message history | Unlimited (MySQL) | Disk space | Standard MySQL scaling |
| File storage | Unlimited (S3/R2) | Budget | Object storage scales infinitely |

For 95% of communities (gaming servers, open source projects, companies), single-instance Ergo + single-instance LiveKit on a $40/month VPS is more than sufficient.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Ergo is single-instance (no clustering yet) | Can't scale past ~10K users | Sufficient for initial target. Clustering is on Ergo's roadmap. Contribute upstream if needed. |
| IRCv3 specs are "draft" status | Could change | Ergo tracks spec changes. Our client is custom so we can adapt. |
| LiveKit is a separate service | Adds operational complexity | Single binary, Docker-friendly. `--dev` mode for development. |
| IRC protocol message size limits | Long messages get truncated | `draft/multiline` handles this. Ergo supports up to 4096 bytes, 100 lines. |
| No native threading in IRC | Threads are client-side illusion | `+draft/reply` gives us message references. Client groups them. Good enough for v1. |
| Browser WebSocket can disconnect | Lost messages | Ergo's always-on mode + CHATHISTORY on reconnect = seamless recovery. |
| Message editing breaks msgid chains | Replies/reactions to edited messages orphaned | Tombstone + edit pointer pattern. Client maintains original→edited msgid mapping. See Message Editing Semantics. |
| Roles/permissions mismatch with IRC | UI suggests fine-grained perms IRC can't enforce | Clearly separate decorative (display names, colors) from enforced (IRC modes). See Server Config Discovery. |
| accord-specific features invisible to other IRC clients | Non-accord clients see raw tags, no embeds, no categories | Acceptable. Core chat works everywhere. accord features degrade to plain text gracefully. |
| Push for channel @mentions requires message content parsing | Must scan message text for @patterns | Start with DM push only (v1). Channel @mention push deferred to v2 (requires parsing history rows). |

---

## Open Questions

1. **Search implementation**: Index MySQL directly, or use a search engine (MeiliSearch/Typesense) for better full-text search?
2. **Mobile strategy**: Start with PWA and add Tauri 2.0 native later? Or skip PWA and go Tauri 2.0 from the start since it supports mobile?
3. **Monorepo structure**: Turborepo? pnpm workspaces? What houses Ergo config, LiveKit config, accord-files, and the client?
4. **EXTJWT migration**: When (if ever) to switch from password-based auth bridge to Ergo's EXTJWT for cleaner token flow?
5. **Channel mention push (v2)**: Parse message content from MySQL history rows for `@accountname` patterns. Regex-based or tokenized? How to handle @here/@everyone?

### Resolved (from review)

- **Auth flow**: Password-based auth bridge through accord-files → Ergo HTTP API. See Auth Bridge section.
- **Channel metadata for voice channels**: Defined in `/.well-known/accord.json` categories config. See Server Config Discovery.
- **Custom emoji storage**: Served from `/.well-known/accord.json`, assets hosted by accord-files. See Server Config Discovery.
- **P2P calls via IRC signaling**: Not viable (SDP payloads too large for TAGMSG). All calls route through LiveKit.
- **Push notification model**: Device heartbeat + idle detection. See Push Notification Pipeline.
- **Decorative vs enforced permissions**: Documented per-property. See Server Config Discovery table.
- **Push event source**: MySQL history polling (not IRC bot — MONITOR can't observe messages). See Push Notification Pipeline.
- **Voice channel detection**: `/.well-known/accord.json` voice category is the sole source. No mode/topic/naming conventions.
- **Invite link format**: Standardized to `https://accord.app/join/<server>/<token>`. See Invite Link System.
- **Server name**: `accord.json` `name` = display name, Ergo `server.name` = hostname. accord.json takes precedence for display.
