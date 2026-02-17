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

**Why Svelte 5?** Rune-based reactivity (`$state`, `$derived`, `$effect`) maps naturally to chat state — 15 reactive stores with zero external state management libraries.

**Why LiveKit?** Single binary SFU with a client SDK. Voice channels are just LiveKit rooms keyed by channel name.

**Why Tauri?** Native desktop performance with a ~5 MB binary. No Electron overhead. WebView2 on Windows, WebKit on macOS/Linux. Direct access to the OS for notifications and window management.

---

## Features

### Chat
- Send/receive messages with mIRC formatting (bold, italic, underline, monospace)
- Message history pagination (CHATHISTORY BEFORE/LATEST/AFTER)
- Replies with quoted parent preview
- Emoji reactions (unicode, via TAGMSG)
- Message editing with `+accord/edit` tag (edit-in-place with original msgid tracking)
- Message deletion (REDACT)
- Typing indicators (throttled, auto-expiring)
- Read markers synced via MARKREAD
- Unread badges and mention counts
- Pinned messages per channel (ops, stored in localStorage)
- Spoiler formatting (`||text||` with blur-until-click reveal)
- Syntax-highlighted code blocks (keyword/string/comment/number detection)
- Slash command popup with 13 IRC commands, descriptions, and keyboard navigation
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
- User profile popout with roles, registration date, and "Send Message"
- Hover cards on member list entries

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

### Server Management
- Server Settings modal with 7 tabs: Overview, Channels, Roles, Members, Invites, Appearance, Moderation
- Invite link system (create, validate, expire, max-use, revoke)
- Server config via `accord.json` (channels, roles, themes, emoji, welcome message)
- Server theme overrides with WCAG contrast warnings and per-server disable toggles
- Custom server emoji in picker, messages, and reactions
- Welcome modal with suggested channels
- Role colors in messages and member list

### Account
- Display name editing in settings UI
- Nick change via `/nick` command
- Email and password change in Account settings
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
- Connection status banner with auto-reconnect
- Rate limit countdown display
- Server list with context menus, drag reorder, and unread/mention badges
- Collapsible system messages (3+ consecutive events collapse with expand toggle)
- Message search panel with `from:user` filter
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

- [Node.js](https://nodejs.org) >= 20 (for SvelteKit)
- [Docker](https://docs.docker.com/get-docker/) & Docker Compose
- [Rust](https://rustup.rs/) (for Tauri desktop builds)

### Quick Start

```bash
# Clone
git clone https://github.com/syzygyhack/accord.git
cd accord

# Configure environment
cp .env.example .env
# Edit .env — set JWT_SECRET at minimum

# Build the client
cd accord-client
npm install
npm run build
cd ..

# Start everything (Ergo, MariaDB, LiveKit, accord-files, Caddy)
docker compose up -d
```

Docker Compose runs all five services. Caddy serves the built client from `/srv/accord` and proxies `/ws` to Ergo, `/api/*` to accord-files.

### LAN Access

To make the server accessible to other machines on your network:

1. Set `LIVEKIT_CLIENT_URL` in `.env` to your LAN IP:
   ```
   LIVEKIT_CLIENT_URL=ws://192.168.1.100:7880
   ```
2. `use_external_ip` is already enabled in the LiveKit config (see `docker-compose.yml` or `config/livekit/config.yaml`).
3. Restart: `docker compose up -d`

All Docker services bind to `0.0.0.0` by default, so ports are already network-accessible.

### Desktop Build (Tauri)

```bash
cd accord-client

# Development (hot-reload with Tauri window)
npm run tauri:dev

# Production build (generates installer for your platform)
npm run tauri:build
```

Requires [Rust](https://rustup.rs/) and platform-specific Tauri dependencies (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

### Development

```bash
# Start all services
docker compose up -d

# Start client dev server (separate terminal)
cd accord-client && npm install && npm run dev
```

### Run Tests

```bash
# Client tests (744 tests, Vitest)
cd accord-client && npm test

# Server tests (155 tests, Bun)
cd accord-files && bun test
```

---

## Project Structure

```
accord/
├── accord-client/                 # Svelte 5 + SvelteKit frontend
│   ├── src/
│   │   ├── components/          # 28 Svelte components
│   │   ├── lib/
│   │   │   ├── api/             # Auth tokens, server discovery, invites, accounts
│   │   │   ├── irc/             # IRC protocol layer
│   │   │   │   ├── parser.ts    # IRCv3 message parser
│   │   │   │   ├── connection.ts # WebSocket + reconnect
│   │   │   │   ├── handler.ts   # Message dispatcher
│   │   │   │   ├── commands.ts  # IRC command builders
│   │   │   │   ├── cap.ts       # CAP negotiation
│   │   │   │   ├── sasl.ts      # SASL PLAIN auth
│   │   │   │   └── format.ts    # mIRC ↔ HTML rendering
│   │   │   ├── state/           # 15 reactive stores ($state runes)
│   │   │   ├── voice/           # LiveKit room + voice call management
│   │   │   ├── files/           # File upload + URL preview client
│   │   │   ├── navigation/      # Channel/server navigation helpers
│   │   │   ├── utils/           # A11y, storage, URL utilities
│   │   │   └── keybindings.ts   # Keyboard shortcut system
│   │   └── routes/
│   │       ├── login/           # Login/register page
│   │       └── chat/            # Main chat page
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
│       │   └── preview.ts       # URL unfurling (OpenGraph)
│       ├── middleware/
│       │   ├── auth.ts          # JWT verification
│       │   └── rateLimit.ts     # Per-IP rate limiting
│       └── env.ts               # Environment config
├── config/
│   ├── ergo/ircd.yaml           # Ergo IRC server config
│   ├── livekit/config.yaml      # LiveKit SFU config (reference for manual runs)
│   └── caddy/Caddyfile          # Reverse proxy rules
├── docker-compose.yml           # 5-service stack
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
| `JWT_SECRET` | Yes | — | JWT signing key |
| `LIVEKIT_API_KEY` | Yes | `devkey` | LiveKit API key |
| `LIVEKIT_API_SECRET` | Yes | `devsecret` | LiveKit API secret |
| `MYSQL_ROOT_PASSWORD` | Yes | `changeme` | MariaDB root password (docker-compose syncs into Ergo) |
| `ERGO_API` | No | `http://ergo:8089` | Ergo HTTP API URL |
| `ERGO_API_TOKEN` | Yes | `dev-ergo-api-token` | Bearer token for Ergo HTTP API (injected into Ergo config) |
| `ERGO_WEBSOCKET_ORIGINS` | No | `["http://localhost","http://127.0.0.1"]` | JSON array of allowed Origin values for IRC WebSocket connections |
| `LIVEKIT_URL` | No | `ws://livekit:7880` | Internal LiveKit signaling URL |
| `LIVEKIT_CLIENT_URL` | No | `ws://localhost:7880` | Client-facing LiveKit URL (set to LAN IP for network access) |
| `ALLOWED_ORIGIN` | No | _(reject all)_ | CORS allowed origin(s). Comma-separated list. When unset, all cross-origin requests are rejected |
| `BASE_URL` | No | — | Base URL for invite links (falls back to request Origin/Host) |
| `SITE_ADDRESS` | No | `:80` | Caddy site address (set to domain for auto-HTTPS) |
| `MAX_FILE_SIZE` | No | `26214400` | Max upload size in bytes (25 MB) |
| `PORT` | No | `8080` | Backend listen port |
| `CONFIG_PATH` | No | `config/accord.json` | Server config file path |
| `SERVER_NAME` | No | — | Server display name |
| `SERVER_ID` | No | — | Stable server identifier for JWTs/invite links (URL-safe; defaults to BASE_URL host or safe SERVER_NAME) |

---

## Docker Compose Services

| Service | Image | Ports | Purpose |
|---------|-------|-------|---------|
| **ergo** | `ghcr.io/ergochat/ergo:stable` | 6667, 8097 | IRC server (WebSocket + plaintext) |
| **mysql** | `mariadb:11` | 3306 | Message history persistence |
| **livekit** | `livekit/livekit-server:v1.9.11` | 7880-7881, 50060-50160/udp | Voice/video SFU |
| **accord-files** | Built from `./accord-files` | 8080 | Auth bridge, file uploads, config |
| **caddy** | `caddy:2` | 80, 443 | Reverse proxy + static SPA |

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
| IRC format/rendering | 77 |
| IRC handler | 70 |
| Message store | 68 |
| Theme store | 57 |
| Notification store | 41 |
| Keybindings | 38 |
| IRC commands | 29 |
| Emoji library | 29 |
| App settings | 28 |
| Member store | 27 |
| Server store | 23 |
| Server config store | 21 |
| Media | 20 |
| Channel store | 18 |
| IRC parser | 18 |
| Voice store | 18 |
| System messages | 17 |
| File preview (client) | 17 |
| IRC connection | 14 |
| Auth API (client) | 13 |
| Typing store | 13 |
| Account info API | 12 |
| CAP negotiation | 12 |
| SASL auth | 11 |
| Discovery | 10 |
| Account API (client) | 9 |
| Connection store | 9 |
| Invite API (client) | 8 |
| User store | 7 |
| File upload (client) | 5 |
| Raw IRC log | 5 |
| **Client total** | **744** |
| URL preview (server) | 54 |
| Invite endpoint | 22 |
| File upload endpoint | 16 |
| Auth endpoint | 15 |
| Config endpoint | 11 |
| Account endpoint | 10 |
| Account info endpoint | 9 |
| Auth middleware | 7 |
| LiveKit endpoint | 6 |
| Rate limiter | 5 |
| **Server total** | **155** |
| **Total** | **899** |

---

## Known Deferrals

| Item | Current State | Notes |
|------|--------------|-------|
| Push notifications | Not implemented | Web Push API planned |
| Search | Client-side only | Ergo SEARCH extension available for future server-side search |
| User avatars / bios | Generated initials only | Blocked on IRCv3 `draft/metadata-2` |
| Screen sharing / video | Audio only for channels | LiveKit supports it; DM video calls work |
| Multi-server | Single server | UI accommodates server list |
| Theme customization UI | Dark/light/AMOLED/compact | CSS vars ready for full theme editor |
| Custom server emoji | Config structure ready | Rendered in emoji picker, tab completion, and messages |
| Voice channel access control | Any authenticated user can get a token | Ergo lacks a channel membership query API |

---

## Documentation

| Document | Description |
|----------|-------------|
| [`PLAN.md`](PLAN.md) | Architecture spec — tech decisions, protocol design, scalability |
| [`FRONTEND.md`](FRONTEND.md) | UI/UX design spec — layout, components, themes, accessibility |

---

## How This Was Built

The codebase was authored by **Claude Opus 4.6** (Anthropic) running inside the **Avril** harness — a session-based agent framework for quality-assured code generation. Work was orchestrated by **Cardinal**, a task planning and execution system that decomposed design specs into implementable work units, managed dependencies, and tracked progress.

Three Cardinal sessions built the project end-to-end:

### Session 1: Core MVP (Feb 12)
Cardinal decomposed the specs into **36 tasks** ordered by dependency graph: Docker infrastructure first, then IRC protocol layer, then UI shell, then features.

Delivered: Docker Compose stack (Ergo, MariaDB, LiveKit, Caddy), SvelteKit project scaffolding, IRC parser/connection/CAP/SASL, all core UI components (Login, Message, MessageList, MessageInput, MemberList, ChannelSidebar, HeaderBar), voice state and LiveKit room management, read markers, unread badges, DM conversations, reconnection with gap fill, responsive layout, and the Tauri desktop shell.

### Session 2: Feature Completion (Feb 15)
Cardinal planned **22 tasks** to close all remaining spec gaps.

Delivered: message editing with `+accord/edit` tag, file upload backend and client UI (drag-and-drop, paste-to-upload), inline media previews (image/video/audio), Open Graph link preview cards with SSRF-protected server-side fetch, four themes (dark/light/AMOLED/compact), compact message display mode, per-channel notification settings, invite link system (create/validate/expire/revoke), server list sidebar with drag reorder, user profile popout, collapsible system messages, custom server emoji, pinned messages, message search panel, keybinding customization UI, raw IRC debug panel, and a full code review pass.

### Session 3: Polish & Review (Feb 16-17)
Cardinal planned **31 tasks** targeting the remaining TODO items and a comprehensive code review.

Delivered: `/join` slash command, member list virtual scrolling and hover cards, server list context menu, message hover menu (edit/copy/mark unread), Server Settings modal (7 tabs), User Settings Notifications and Account tabs, user profile popout with registered date, resizable sidebar columns, channel sidebar ops affordances (create button, drag reorder, read-only icons), header bar channel settings gear, reaction bar improvements, keyboard shortcuts, server config integration (welcome modal, role colors), spoiler formatting, syntax-highlighted code blocks, empty states and image blur-up transitions, shared constant deduplication, and two rounds of code review fixes (security, performance, accessibility, CSS).

### Post-Cardinal
Development continued as **human-agent collaboration** — the human directed priorities and reviewed results while Claude (Opus 4.6 via Avril) implemented features and fixes. Cross-model review (**Claude + OpenAI Codex**) identified issues including MODE parsing drift, MONITOR timing races, and slash command edge cases, all resolved. Post-Cardinal work added: voice manager extraction, accessibility utilities (focus trapping, menu keyboard navigation, ARIA tab patterns), channel navigation module, server theme disable toggles, WCAG contrast warnings, and a comprehensive TODO rewrite for the rename/publish roadmap.

### By the Numbers

| Metric | Value |
|--------|-------|
| TypeScript + Svelte source | ~25,600 lines |
| Test code | ~9,900 lines |
| Design specs | ~1,860 lines |
| Infrastructure config | ~1,400 lines |
| Components | 28 |
| Reactive stores | 15 |
| Commits | 131+ |
| Packages | 2 |
| Tests | 899 |
| Cardinal tasks | 89 |

---

## License

MIT
