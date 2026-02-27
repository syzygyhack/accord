# accord

**A Discord-competitive chat platform built on IRC.**

accord wraps the battle-tested IRC protocol in a modern UI — real-time messaging, voice channels, reactions, typing indicators, presence, and read markers — all running on standard IRCv3 infrastructure. Ships as a native desktop app via Tauri. No proprietary server. No vendor lock-in. One WebSocket connection.

> Svelte 5. IRC native. LiveKit voice. Tauri desktop. Self-hostable.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  accord Desktop App                     │
│        (Tauri 2 + Svelte 5 + SvelteKit SPA)             │
├──────────────┬──────────────────────┬───────────────────┤
│  WebSocket   │   HTTP + JWT         │   WebRTC          │
│  (IRC)       │   (Auth, Config)     │   (Voice/Video)   │
├──────────────┼──────────────────────┼───────────────────┤
│  Ergo IRC    │   accord-files       │   LiveKit SFU     │
│  - Accounts  │   - Auth bridge      │  - Voice rooms    │
│  - Channels  │   - JWT minting      │  - Mute/deafen    │
│  - History   │   - Config serving   │  - Speaker detect │
│  - Always-on │   - LK token gen     │                   │
│  - WebSocket │   - File uploads     │                   │
│              │   - URL previews     │                   │
│              │   - Invite links     │                   │
├──────────────┴──────────────────────┴───────────────────┤
│                   MariaDB                               │
│              (message history)                          │
├─────────────────────────────────────────────────────────┤
│                    Caddy                                │
│     (reverse proxy, TLS termination, static serving)    │
└─────────────────────────────────────────────────────────┘
```

The client connects to Ergo over a single WebSocket for all chat functionality. Voice goes peer-to-peer via LiveKit. The backend (`accord-files`) handles auth (validating credentials against Ergo's HTTP API and minting JWTs), file uploads, URL preview unfurling, invite links, and server configuration. Caddy fronts everything.

### Design Decisions

**Why IRC?** Ergo is a single Go binary that provides accounts, channels, message history, always-on clients, and a full IRCv3 extension set out of the box. It replaces what would otherwise be a custom chat server, a message queue, a presence system, and a history database.

**Why Svelte 5?** Rune-based reactivity (`$state`, `$derived`, `$effect`) maps naturally to chat state — 16 reactive stores with zero external state management libraries.

**Why LiveKit?** Single binary SFU with a client SDK. Voice channels are just LiveKit rooms keyed by channel name.

**Why Tauri?** Native desktop performance with a ~5 MB binary. No Electron overhead. WebView2 on Windows, WebKit on macOS/Linux. Direct access to the OS for notifications and window management.

---

## Features

### Chat
- Send/receive messages with mIRC formatting (bold, italic, underline, monospace, 99-color palette)
- Message history pagination (CHATHISTORY BEFORE/LATEST/AFTER)
- Replies with quoted parent preview
- Emoji reactions (unicode, via TAGMSG)
- Message editing with `+accord/edit` tag (edit-in-place with original msgid tracking)
- Edit history viewer — "(edited)" label with click-to-view previous versions
- Message deletion (REDACT)
- Threaded conversations — reply chains grouped in a sidebar ThreadView
- Typing indicators (throttled, auto-expiring)
- Read markers synced via MARKREAD
- Unread badges and mention counts
- Pinned messages per channel (ops, stored in localStorage)
- Spoiler formatting (`||text||` with blur-until-click reveal)
- Syntax-highlighted code blocks (keyword/string/comment/number detection)
- Slash command popup with 10 IRC commands, descriptions, and keyboard navigation
- Commands gated by channel privilege level (mod commands require halfop+)
- `//` escape to send literal `/`-prefixed messages

### Media & Files
- File uploads with drag-and-drop, paste-to-upload, and file picker
- Inline image thumbnails with blur-up loading and click-to-expand lightbox
- Inline video and audio players
- Open Graph link preview cards (title, description, thumbnail)
- URL unfurling via server-side SSRF-protected fetch with DNS pinning

### Channels & DMs
- Channel list with configurable categories
- Channel topic display and inline editing
- Direct messages as separate buffer panes
- DM voice and video calls
- Quick channel switcher (Ctrl+K)
- Per-channel notification settings (all, mentions, nothing, mute)
- Channel drag-and-drop reorder (ops)

### Members & Presence
- Role-grouped member list with virtual scrolling
- Online/idle/DND/offline presence dots
- MONITOR-based live presence tracking
- Away status via away-notify
- Nick coloring by account hash (40% lightness on light, 65% on dark)
- User profile popout with avatar, bio, roles, registration date, and "Send Message"
- Hover cards on member list entries
- User avatars (uploaded via profile API, lazy-loaded, with magic byte validation)
- Bio editing in User Settings with dirty-tracking save bar

### Voice
- Join/leave voice channels via LiveKit
- Mute and deafen toggles
- Push-to-talk with configurable keybind (window blur safety auto-releases)
- Speaking indicator (green ring)
- Participant list in sidebar with mute/deafen status icons
- Noise suppression toggle (browser-native)
- Input/output device selection with live switching while connected
- Mic tester with loopback audio, mono-to-stereo upmix, and level meter
- Output volume control applied to all remote tracks
- Camera and screen share controls
- DM voice/video calls with deterministic room names
- Automatic disconnect handling with state cleanup

### Notifications
- Notification sounds (mention, message) with volume control and per-type toggles
- Desktop notifications via Web Notification API when window is unfocused

### Offline & PWA
- IndexedDB message cache (last 200 messages per channel, write-through)
- Instant message hydration from cache on app startup
- Service worker with app shell caching (stale-while-revalidate)
- PWA manifest for installable web app
- Offline detection via navigator.onLine with reactive UI banner
- Graceful degradation — cached messages viewable offline, history fetch gated when disconnected

### Server Management
- Server Settings modal with 7 tabs: Overview, Channels, Roles, Members, Invites, Appearance, Moderation
- Admin panel with 4 tabs: Dashboard (stats), Users, Audit Log, Announce — accessible to accounts in `ADMIN_ACCOUNTS`
- Invite link system (create, validate, expire, max-use, revoke)
- Server config via `accord.json` (channels, roles, themes, emoji, welcome message)
- Server theme overrides with WCAG contrast warnings and per-server disable toggles
- Custom server emoji in picker, messages, and reactions
- Welcome modal with suggested channels
- Role colors in messages and member list

### Account
- Profile editing (bio, avatar) in settings UI with dirty-tracking save bar
- Password change in Account settings
- Persistent login across app restarts (OS keychain via Tauri, localStorage fallback for web)

### Desktop (Tauri 2)
- Native window with 1280x800 default, 600x400 minimum
- Bundled for Windows (.msi/.exe), macOS (.dmg), and Linux (.deb/.AppImage)
- Splash screen with fade-out transition on startup
- OS keychain credential storage (Windows Credential Manager, macOS Keychain, Linux Secret Service)
- No browser required — runs as a standalone app

### UI
- Three-column responsive layout (server list + sidebar + messages + members)
- Four themes: dark, light, AMOLED, compact (IRC-inspired high-density mode)
- Resizable sidebar columns with drag handles
- Keyboard shortcuts (Ctrl+K, Alt+Up/Down, Escape, Shift+Escape, Ctrl+Shift+M/D)
- Customizable keybindings with recording UI
- Tab completion (@user, #channel, :emoji:)
- Hover toolbar (React, Reply, More)
- Connection status banner with auto-reconnect, offline detection, and DM/MONITOR restore
- Scroll-to-message highlight animation
- Rate limit countdown display
- Server list with context menus, drag reorder, and unread/mention badges
- Collapsible system messages (3+ consecutive events collapse with expand toggle)
- Message search panel with `from:user`, `in:channel`, `has:image`, `has:link`, `before:date`, `after:date` filters
- Raw IRC debug panel (Advanced settings)
- Keyboard alternative for drag-and-drop reorder (Alt+Arrow)
- Focus trapping in modals and ARIA tab patterns in settings
- Context menu keyboard navigation (Arrow keys, Home/End, Escape)

---

## IRCv3 Capabilities

accord negotiates these capabilities with the server:

| Capability | Purpose |
|------------|---------|
| `sasl` | SASL PLAIN authentication |
| `message-tags` | Client tags for reactions, replies, typing |
| `echo-message` | Server echoes own messages with msgid/time |
| `server-time` | All messages timestamped |
| `batch` | CHATHISTORY results grouped in batch |
| `labeled-response` | Request/response correlation |
| `draft/chathistory` | Message history pagination |
| `draft/read-marker` | MARKREAD for unread sync |
| `draft/event-playback` | Replay JOIN/PART in history |
| `draft/message-redaction` | REDACT command |
| `account-tag` | Sender account in tags |
| `account-notify` | Account login/logout |
| `away-notify` | AWAY status changes |
| `extended-join` | JOIN includes account + realname |
| `multi-prefix` | All mode prefixes in NAMES |
| `userhost-in-names` | Full hostmask in NAMES |
| `cap-notify` | Server-initiated CAP changes |
| `setname` | Real name changes |

Client-only tags (relayed transparently): `+draft/reply`, `+draft/react`, `+typing`, `+accord/edit`.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) >= 20 and [pnpm](https://pnpm.io) (for SvelteKit)
- [Docker](https://docs.docker.com/get-docker/) & Docker Compose
- [Rust](https://rustup.rs/) (for Tauri desktop builds)

### Initial Setup

```bash
# Clone
git clone https://github.com/syzygyhack/accord.git
cd accord

# Configure environment
cp .env.example .env
# Edit .env — set JWT_SECRET (min 32 chars), LIVEKIT_API_KEY/SECRET, ERGO_API_TOKEN, MYSQL_ROOT_PASSWORD

# Build the client (required for both dev and LAN)
cd accord-client
pnpm install
pnpm build
cd ..
```

There are two Docker Compose files for different deployment modes:

| File | Purpose | Access |
|------|---------|--------|
| `docker-compose.yml` | Local development | `localhost` only |
| `docker-compose.lan.yml` | LAN deployment | Other machines on your network |

### Development (localhost)

`docker-compose.yml` exposes Ergo (8097) and accord-files (8080) ports directly so the Vite dev server can proxy to them. Use this when developing the client with hot-reload.

```bash
# Start backend services
docker compose up -d

# Start client dev server (separate terminal)
cd accord-client && pnpm dev
```

The client dev server runs at `http://localhost:5173`. Vite proxies `/api/*` and `/.well-known/*` to accord-files, and the login page connects to `ws://localhost:8097` for the IRC WebSocket.

No special `.env` values are needed — the defaults in `docker-compose.yml` target localhost.

### LAN Deployment

`docker-compose.lan.yml` locks backend ports to localhost and routes everything through Caddy on port 80. It wires `LIVEKIT_CLIENT_URL` and `BASE_URL` from a single `LAN_IP` variable so LAN clients connect to the right addresses.

**1. Find your LAN IP:**

```bash
# Linux/macOS
ip route get 1 | awk '{print $7; exit}'
# Windows (PowerShell)
(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike '*Loopback*' -and $_.PrefixOrigin -eq 'Dhcp' }).IPAddress
```

**2. Set `LAN_IP` in `.env`:**

```bash
# .env
LAN_IP=192.168.1.100
```

**3. Build the client** (if you haven't already):

```bash
cd accord-client && pnpm build && cd ..
```

**4. Start services:**

```bash
docker compose -f docker-compose.lan.yml up -d
```

LAN clients connect to `http://<LAN_IP>` in their browser. The login page server URL field should be `ws://<LAN_IP>/ws`.

**What `docker-compose.lan.yml` fixes vs the dev file:**

| Issue | Dev compose | LAN compose |
|-------|-------------|-------------|
| LiveKit client URL | `ws://localhost:7880` | `ws://<LAN_IP>:7880` |
| Ergo/accord-files ports | Exposed to all interfaces | Bound to `127.0.0.1` |
| Caddy port 443 | Exposed | Not exposed (plain HTTP) |
| Invite link base URL | Unset | `http://<LAN_IP>` |

**Firewall:** Ensure ports 80 (HTTP), 7880-7881 (LiveKit signaling), and 50060-50160/udp (WebRTC media) are open on the host firewall.

### Desktop Build (Tauri)

```bash
cd accord-client

# Development (hot-reload with Tauri window)
pnpm tauri:dev

# Production build (generates installer for your platform)
pnpm tauri:build
```

Requires [Rust](https://rustup.rs/) and platform-specific Tauri dependencies (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

### Run Tests

```bash
# Client tests (938 tests, Vitest)
cd accord-client && pnpm test

# Server tests (279 tests, Bun)
cd accord-files && bun test
```

---

## Project Structure

```
accord/
├── accord-client/                 # Svelte 5 + SvelteKit frontend
│   ├── src/
│   │   ├── components/          # 31 Svelte components
│   │   ├── lib/
│   │   │   ├── api/             # Auth tokens, server discovery, invites, accounts, admin
│   │   │   ├── irc/             # IRC protocol layer
│   │   │   │   ├── parser.ts    # IRCv3 message parser
│   │   │   │   ├── connection.ts # WebSocket + reconnect
│   │   │   │   ├── handler.ts   # Message dispatcher
│   │   │   │   ├── commands.ts  # IRC command builders
│   │   │   │   ├── cap.ts       # CAP negotiation
│   │   │   │   ├── sasl.ts      # SASL PLAIN auth
│   │   │   │   └── format.ts    # mIRC ↔ HTML rendering
│   │   │   ├── state/           # 16 reactive stores ($state runes)
│   │   │   ├── voice/           # LiveKit room + voice call management
│   │   │   ├── files/           # File upload + URL preview client
│   │   │   ├── connection/      # Reconnect lifecycle (gap fill, DM restore, MONITOR)
│   │   │   ├── navigation/      # Channel/server navigation helpers
│   │   │   ├── cache/           # IndexedDB message cache
│   │   │   │   └── messageCache.ts # IDB CRUD, serialization, hydration
│   │   │   ├── utils/           # A11y, storage, URL utilities
│   │   │   ├── channelMonitor.ts # MONITOR nick tracking for DMs
│   │   │   └── keybindings.ts   # Keyboard shortcut system
│   │   └── routes/
│   │       ├── +error.svelte    # Error boundary page
│   │       ├── login/           # Login/register page
│   │       └── chat/            # Main chat page
│   ├── static/
│   │   ├── sw.js               # Service worker (app shell caching)
│   │   └── manifest.json       # PWA manifest
│   └── src-tauri/               # Tauri 2 desktop shell
│       ├── Cargo.toml           # Rust dependencies
│       ├── tauri.conf.json      # Window, bundle, security config
│       ├── capabilities/        # Tauri permission grants
│       ├── icons/               # App icons (all platforms)
│       └── src/                 # Rust entry point
├── accord-files/                  # Bun + Hono backend (runs in Docker)
│   └── src/
│       ├── routes/
│       │   ├── auth.ts          # POST /api/auth (JWT minting)
│       │   ├── account.ts       # POST /api/account (email/password change)
│       │   ├── livekit.ts       # POST /api/livekit/token
│       │   ├── config.ts        # GET /.well-known/accord.json
│       │   ├── files.ts         # File upload/download
│       │   ├── invite.ts        # Invite link CRUD
│       │   ├── preview.ts       # URL unfurling (OpenGraph)
│       │   ├── profile.ts       # User profile CRUD + avatar upload
│       │   └── admin.ts         # Admin API (stats, users, kick/ban, audit)
│       ├── middleware/
│       │   ├── auth.ts          # JWT verification
│       │   ├── admin.ts         # Admin account authorization
│       │   └── rateLimit.ts     # Per-IP rate limiting
│       ├── profileStore.ts      # JSON file-backed profile storage
│       ├── securityLog.ts       # Structured security event logging
│       └── env.ts               # Environment config
├── config/
│   ├── ergo/ircd.yaml           # Ergo IRC server config
│   ├── livekit/config.yaml      # LiveKit SFU config (reference for manual runs)
│   └── caddy/Caddyfile          # Reverse proxy rules
├── docker-compose.yml           # 5-service stack (dev — localhost)
├── docker-compose.lan.yml      # 5-service stack (LAN — network-accessible)
├── PLAN.md                      # Architecture spec
└── FRONTEND.md                  # UI/UX design spec
```

---

## Configuration

Server identity, channel layout, roles, and theming are driven by `accord.json`, served at `/.well-known/accord.json`:

```jsonc
{
  "name": "My Server",
  "icon": "/icon.png",
  "description": "An accord community",
  "channels": {
    "categories": [
      {
        "name": "Text Channels",
        "channels": ["#general", "#random"]
      },
      {
        "name": "Voice",
        "channels": ["#voice-lobby"],
        "voice": true
      }
    ]
  },
  "roles": {
    "~": { "name": "Owner", "color": "#e0a040" },
    "@": { "name": "Moderator", "color": "#50a0e0" }
  },
  "theme": {
    "--surface-base": "#1a1a2e",
    "--accent": "#e94560"
  },
  "welcome": {
    "message": "Welcome! Check out #general to get started.",
    "suggestedChannels": ["#general", "#introductions"]
  }
}
```

No client forking required for customization.

### Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `JWT_SECRET` | Yes | — | JWT signing key (min 32 characters) |
| `LIVEKIT_API_KEY` | Yes | — | LiveKit API key |
| `LIVEKIT_API_SECRET` | Yes | — | LiveKit API secret |
| `MYSQL_ROOT_PASSWORD` | Yes | — | MariaDB root password |
| `ERGO_API_TOKEN` | Yes | — | Bearer token for Ergo HTTP API (injected into Ergo config) |
| `LAN_IP` | LAN only | — | Your machine's LAN IP. Required by `docker-compose.lan.yml` |
| `SERVER_NAME` | No | — | Server display name |
| `SERVER_ID` | No | — | Stable server identifier for JWTs/invite links (URL-safe) |
| `MYSQL_ERGO_PASSWORD` | No | _(falls back to MYSQL_ROOT_PASSWORD)_ | Dedicated MariaDB password for the `ergo` user |
| `SITE_ADDRESS` | No | `:80` | Caddy site address (set to domain for auto-HTTPS) |
| `MAX_FILE_SIZE` | No | `26214400` | Max upload size in bytes (25 MB) |
| `ADMIN_ACCOUNTS` | No | — | Comma-separated list of admin Ergo account names |

---

## Docker Compose Services

Both compose files run the same five services. The difference is port exposure:

| Service | Image | Dev ports | LAN ports | Purpose |
|---------|-------|-----------|-----------|---------|
| **ergo** | `ghcr.io/ergochat/ergo:stable` | 6667, 8097 | 127.0.0.1 only | IRC server (WebSocket + plaintext) |
| **mysql** | `mariadb:11` | _(internal only)_ | _(internal only)_ | Message history persistence |
| **livekit** | `livekit/livekit-server:v1.9.11` | 7880-7881, 50060-50160/udp | 7880-7881, 50060-50160/udp | Voice/video SFU |
| **accord-files** | Built from `./accord-files` | 8080 | 127.0.0.1 only | Auth bridge, file uploads, config |
| **caddy** | `caddy:2` | 80, 443 | 80 | Reverse proxy + static SPA |

In LAN mode, Ergo and accord-files are only reachable through Caddy. In dev mode, their ports are exposed directly for the Vite dev server proxy.

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Desktop shell | Tauri | 2 |
| Client framework | Svelte | 5 |
| Meta framework | SvelteKit | 2 |
| Build tool | Vite | 6 |
| Client testing | Vitest | 4 |
| IRC parsing | irc-message-ts | 3 |
| Voice/video SDK | livekit-client | 2 |
| Backend framework | Hono | 4 |
| JWT library | jose | 6 |
| Backend runtime | Bun | 1.3+ |
| IRC server | Ergo | stable |
| Voice server | LiveKit | 1.9.11 |
| Database | MariaDB | 11 |
| Reverse proxy | Caddy | 2 |
| TypeScript | | 5 |

---

## Test Coverage

| Suite | Tests |
|-------|-------|
| Message store | 108 |
| IRC handler | 94 |
| IRC format/rendering | 77 |
| Theme store | 57 |
| IRC commands | 42 |
| Notification store | 41 |
| Keybindings | 38 |
| Server config store | 29 |
| Emoji library | 29 |
| App settings | 28 |
| Member store | 27 |
| Admin API (client) | 26 |
| IRC connection | 26 |
| Profile store (client) | 26 |
| Server store | 23 |
| Media | 20 |
| Channel store | 18 |
| IRC parser | 18 |
| Voice store | 18 |
| File preview (client) | 17 |
| System messages | 17 |
| Sound | 15 |
| Notifications (client) | 15 |
| Auth API (client) | 13 |
| Typing store | 13 |
| Account info API | 12 |
| CAP negotiation | 12 |
| SASL auth | 11 |
| Discovery | 10 |
| Account API (client) | 9 |
| Connection store | 13 |
| Message cache (IDB) | 11 |
| Invite API (client) | 8 |
| User store | 7 |
| File upload (client) | 5 |
| Raw IRC log | 5 |
| **Client total** | **934** |
| URL preview (server) | 54 |
| Admin endpoint | 36 |
| Profile endpoint | 36 |
| File upload endpoint | 25 |
| Invite endpoint | 22 |
| LiveKit endpoint | 17 |
| Env validation | 13 |
| Profile store (server) | 16 |
| Auth endpoint | 13 |
| Config endpoint | 11 |
| Account endpoint | 5 |
| Account info endpoint | 9 |
| Auth middleware | 7 |
| Rate limiter | 5 |
| **Server total** | **269** |
| **Total** | **1,203** |

---

## Security Considerations

**JWT secrets:** `JWT_SECRET` must be at least 32 characters (256 bits) per RFC 7518 Section 3.2. The server refuses to start if the secret is too short. All required secrets (`JWT_SECRET`, `ERGO_API_TOKEN`, `LIVEKIT_API_KEY`/`SECRET`, `MYSQL_ROOT_PASSWORD`) have no insecure defaults — they must be explicitly set.

**Security audit logging:** All security-relevant events (auth success/failure, file uploads, invite operations, account changes) are logged as structured JSON to stdout. Pipe to a log aggregator (Loki, Datadog, CloudWatch) in production for incident response and audit trails.

**Database isolation:** MariaDB uses a dedicated `ergo` user with limited privileges rather than root. Set `MYSQL_ERGO_PASSWORD` separately from `MYSQL_ROOT_PASSWORD` in production.

**Rate limiting:** The rate limiter uses `TRUST_PROXY` to decide whether to read client IPs from `X-Forwarded-For`. When enabled without a trusted reverse proxy, attackers can spoof IPs to bypass rate limits. In production, always run behind Caddy (or another trusted proxy) and ensure no untrusted path can reach accord-files directly. When `TRUST_PROXY` is disabled (the default), the socket address is used.

**Rate limit store:** The in-memory rate limit store caps at 50K entries with periodic cleanup. Under sustained attack from rotating IPs, the store can fill to the cap. For high-traffic deployments, consider an external rate limiter (e.g., Caddy's `rate_limit` directive or a WAF).

**SSRF protection:** URL preview fetching validates hostnames against a private IP blocklist and pins DNS resolution to prevent rebinding. The blocklist covers IPv4 private ranges, IPv6 loopback/link-local/ULA/documentation, and `0.0.0.0`/`::`. OpenGraph `og:image` URLs are also validated against the same blocklist. Ensure accord-files cannot reach sensitive internal services even if a bypass is found.

**File uploads:** Uploaded files are validated by magic bytes (PNG, JPEG, GIF, WebP, PDF, ZIP) in addition to extension checks. HSTS headers and request body size limits (30 MB) are enforced at the Caddy layer.

**Credentials in web builds:** In non-Tauri (browser) deployments, auth credentials are stored in `localStorage`. In Tauri desktop builds, the OS keyring is used instead. For web deployments, ensure the origin is protected against XSS.

**SASL over plaintext:** SASL PLAIN authentication sends credentials base64-encoded (not encrypted). Always use `wss://` (TLS) for the WebSocket connection in production. The default Docker Compose setup routes through Caddy which terminates TLS.

**Known accepted risks** (from code review):

| Risk | Severity | Mitigation |
|------|----------|------------|
| LiveKit channel membership not verified | MEDIUM | Blocked on Ergo API; mitigated by auth requirement + rate limits |
| `as any` casts for browser APIs (LiveKit, AudioContext) | LOW | Runtime APIs lack TS types; no workaround |
| HTTPS TOCTOU window in SSRF prevention | LOW | Tiny window; requires DNS rebinding during TLS handshake |

---

## Operations

### Backup & Recovery

Four Docker volumes hold all persistent state:

| Volume | Contents | Loss Impact |
|--------|----------|-------------|
| `ergo-data` | Ergo account database, channel registrations, MOTD | All user accounts and channel ownership lost |
| `mysql-data` | MariaDB message history (`ergo_history` database) | All message history lost |
| `accord-uploads` | Uploaded files (images, documents) | All shared files become broken links |
| `accord-data` | Invite links, profiles, server-side JSON stores | Invites and profiles lost |

**Backup commands:**

```bash
# Stop services to ensure consistency (or use --read-only snapshots if your storage supports it)
docker compose stop

# Back up each volume
for vol in ergo-data mysql-data accord-uploads accord-data; do
  docker run --rm -v "$(docker compose config --format json | jq -r '.name')_${vol}:/data" \
    -v "$(pwd)/backups:/backup" alpine \
    tar czf "/backup/${vol}-$(date +%Y%m%d).tar.gz" -C /data .
done

# Restart services
docker compose up -d
```

**Alternative — live MariaDB dump (no downtime):**

```bash
docker compose exec mysql mariadb-dump -u root -p"$MYSQL_ROOT_PASSWORD" ergo_history > backups/ergo_history.sql
```

**Recovery:**

```bash
# Restore volumes from backup
for vol in ergo-data mysql-data accord-uploads accord-data; do
  docker run --rm -v "$(docker compose config --format json | jq -r '.name')_${vol}:/data" \
    -v "$(pwd)/backups:/backup" alpine \
    sh -c "rm -rf /data/* && tar xzf /backup/${vol}-YYYYMMDD.tar.gz -C /data"
done

# Restart
docker compose up -d
```

**Recommended schedule:** Daily backups of all four volumes. Retain at least 7 daily snapshots. For MariaDB specifically, consider hourly SQL dumps if message history is critical.

### Upgrade Runbook

**Version pinning:** The default `ergo:stable` tag is a floating tag — it can change between `docker compose pull` runs. For production, pin to a specific version:

```yaml
# docker-compose.yml
services:
  ergo:
    image: ghcr.io/ergochat/ergo:v2.17.0  # pin instead of :stable
```

Similarly, pin MariaDB (`mariadb:11.4`), LiveKit (`livekit/livekit-server:v1.9.11` — already pinned), and Caddy (`caddy:2.9`).

**Upgrade procedure:**

1. **Back up all volumes** (see Backup & Recovery above)
2. **Check release notes** for the service you're upgrading:
   - Ergo: https://github.com/ergochat/ergo/releases
   - MariaDB: https://mariadb.com/kb/en/release-notes/
   - LiveKit: https://github.com/livekit/livekit/releases
3. **Update the image tag** in `docker-compose.yml`
4. **Pull the new image:**
   ```bash
   docker compose pull <service>
   ```
5. **Recreate the service:**
   ```bash
   docker compose up -d <service>
   ```
6. **Verify health:**
   ```bash
   docker compose ps       # All services "healthy"
   docker compose logs -f <service> --since 1m  # Check for errors
   ```

**Rollback strategy:**

If an upgrade breaks something:

```bash
# Stop the broken service
docker compose stop <service>

# Restore the volume from your pre-upgrade backup (see Backup & Recovery)
# Then re-tag docker-compose.yml back to the previous image version

# Restart
docker compose up -d
```

Keep previous Docker images locally until the upgrade is confirmed stable (`docker image ls` to verify they haven't been pruned).

**Breaking change checklist:**

- **Ergo:** Check for `ircd.yaml` config format changes between versions. Ergo logs warnings on startup for deprecated keys.
- **MariaDB:** Major version upgrades (e.g., 10 → 11) may require `mariadb-upgrade`. Check logs after restart.
- **LiveKit:** Config format is stable but `room` and `rtc` options may change. Compare your config against the release notes.
- **accord-files:** Rebuild after code changes: `docker compose build accord-files && docker compose up -d accord-files`

### Reverse Proxy: nginx Alternative

The default setup uses Caddy. If you prefer nginx, here's an equivalent configuration:

```nginx
# /etc/nginx/conf.d/accord.conf

upstream accord_backend {
    server 127.0.0.1:8080;  # accord-files
}

upstream ergo_ws {
    server 127.0.0.1:8097;  # Ergo WebSocket
}

server {
    listen 80;
    server_name chat.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name chat.example.com;

    # TLS — managed by certbot / Let's Encrypt
    ssl_certificate     /etc/letsencrypt/live/chat.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;

    # Security headers (match Caddy defaults)
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header Content-Security-Policy "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data: blob: https:; media-src 'self' blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'" always;

    # Max upload size (match accord-files limit)
    client_max_body_size 30M;

    # IRC WebSocket
    location /ws {
        proxy_pass http://ergo_ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;  # Keep WebSocket alive
    }

    # API + server config
    location /api/ {
        proxy_pass http://accord_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /.well-known/ {
        proxy_pass http://accord_backend;
    }

    # Static client files (SPA fallback)
    root /srv/accord;
    location / {
        try_files $uri /index.html;
    }

    # Immutable hashed assets
    location /_app/immutable/ {
        expires max;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
}
```

**Setup with Let's Encrypt:**

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate (with nginx running on port 80)
sudo certbot --nginx -d chat.example.com

# Auto-renewal is configured by certbot automatically
```

**Important: LiveKit UDP passthrough.** LiveKit requires direct UDP access on ports 50060-50160 for WebRTC media. nginx cannot proxy UDP — these ports must be exposed directly to the internet (or use a TURN server). If you're behind a firewall, ensure these UDP ports are forwarded to the LiveKit host. TCP fallback on port 7881 is available but increases latency.

If you use nginx in front of Caddy's default ports, remove the Caddy service from `docker-compose.yml` and expose accord-files and Ergo ports directly (uncomment the port mappings in `docker-compose.yml`).

**Set `TRUST_PROXY=true`** in accord-files when running behind nginx so rate limiting uses the real client IP from `X-Forwarded-For`.

### Admin Setup

accord supports an admin panel for server management. Admin access is controlled by the `ADMIN_ACCOUNTS` environment variable.

**Configuration:**

Add admin usernames (Ergo account names) to `ADMIN_ACCOUNTS` as a comma-separated list in your `.env`:

```bash
# .env
ADMIN_ACCOUNTS=alice,bob
```

These must match the Ergo account names exactly (case-sensitive). Restart accord-files after changing:

```bash
docker compose restart accord-files
```

**Accessing the admin panel:**

Admin API endpoints are available at `/api/admin/*`. All requests require a valid JWT from an account listed in `ADMIN_ACCOUNTS`. The admin middleware checks the JWT `sub` claim against the configured admin list.

**Admin capabilities:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/stats` | GET | Server dashboard — registered accounts, channels, uptime |
| `/api/admin/users` | GET | List all user profiles |
| `/api/admin/kick` | POST | Kick a user from a channel |
| `/api/admin/ban` | POST | Ban a user from a channel (with optional duration) |
| `/api/admin/audit` | GET | View security audit log (paginated) |
| `/api/admin/announce` | POST | Send a message to a channel as the server |

**Relation to IRC operator commands:**

The admin API proxies actions through Ergo's HTTP API, which means:

- `/api/admin/kick` → equivalent to IRC `KICK #channel nick :reason`
- `/api/admin/ban` → equivalent to IRC `/CS BAN #channel nick duration :reason`
- `/api/admin/announce` → equivalent to IRC `PRIVMSG #channel :message` (sent as ChanServ)

Admin users do **not** need IRC operator (`/OPER`) privileges. The admin API authenticates to Ergo using the `ERGO_API_TOKEN` bearer token, which has server-level authority. This means admins can moderate through the web panel without learning IRC commands.

All admin actions are recorded in the security audit log with the admin's account name, IP address, and action details.

---

## Known Deferrals

| Item | Current State | Notes |
|------|--------------|-------|
| Push notifications | Not implemented | Web Push API planned (service worker already in place) |
| Search | Client-side only | Ergo SEARCH extension available for future server-side search |
| Screen sharing / video | Audio only for channels | LiveKit supports it; DM video calls work |
| Multi-server | Single server | UI accommodates server list; data model supports it |
| Theme customization UI | Dark/light/AMOLED/compact | CSS vars ready for full theme editor |
| Profile Layer 2 (signing) | Profiles implemented, no crypto | Ed25519 keypair generation, signed blobs, portable identity planned for v2 |
| Voice channel access control | Any authenticated user can get a token | Ergo lacks a channel membership query API; mitigated by auth requirement, rate limiting, and room participant caps |
| E2EE for DMs | Not implemented | Planned for v2 |
| Federation | Not implemented | Planned for v2 |
| Plugin API / webhooks | Not implemented | Bot framework planned for v2 |
| Tauri mobile | Desktop only | iOS/Android planned for v2 |
| Offline compose queue | Not implemented | Messages composed offline are not queued for send |

---

## Documentation

| Document | Description |
|----------|-------------|
| [`PLAN.md`](PLAN.md) | Architecture spec — tech decisions, protocol design, scalability |
| [`FRONTEND.md`](FRONTEND.md) | UI/UX design spec — layout, components, themes, accessibility |

---

## How This Was Built

Built by **Claude Opus 4.6** (Anthropic) via the **Avril** agent framework, orchestrated by **Cardinal** task planning. Six development sessions from core MVP through security hardening and UX polish. See [BUILD_LOG.md](BUILD_LOG.md) for the full session-by-session breakdown.

| Metric | Value |
|--------|-------|
| TypeScript + Svelte source | ~28,000 lines |
| Test code | ~13,700 lines |
| Components | 31 |
| Reactive stores | 16 |
| Tests | 1,200+ |

---

## License

MIT
