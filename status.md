# accord - Project Status

Current state of the codebase and remaining work.

---

## What accord Is

A Discord-competitive chat platform built on IRC. Svelte 5 + SvelteKit frontend, Tauri 2 desktop shell, Bun + Hono backend, Ergo IRC server, LiveKit voice/video, MariaDB, Caddy reverse proxy. 1,198 tests across client (922) and server (276). Single `docker compose up` deployment.

---

## What's Done

All six phases of the work plan are complete. 60+ spec items fully implemented.

| Area | Details |
|------|---------|
| **Layout** | Three-column Discord layout with resizable panels, responsive breakpoints (1200/900px) |
| **Channels** | Categories, collapse, types (#/voice/pin), badges, mute, create, drag reorder, notification levels |
| **Messages** | Cozy + compact modes, 7-min grouping, hover toolbar (react/reply/edit/delete/pin/copy), unread divider, scroll anchoring, history loading |
| **Reactions** | Pill badges, own highlighted, toggle, who-reacted tooltip |
| **Input** | Auto-grow, tab completion (@/#/:emoji:/), file upload (drag/paste/+), emoji picker, typing indicator, slash commands |
| **Members** | Role groups from IRC modes, presence dots, hover cards, profile popout, context menu |
| **Voice/Video** | LiveKit integration, mute/deafen/camera/screenshare/disconnect, overlay with speaking rings and video grid, 1-on-1 DM calls |
| **Search** | Full-text, debounced, result navigation, `from:`, `in:`, `has:image`, `has:link`, `before:date`, `after:date` filters |
| **DMs** | Separate sidebar section, max 50, localStorage persistence, voice/video calls |
| **Server Settings** | 7 tabs: Overview, Channels, Roles, Members, Invites, Appearance, Moderation |
| **User Settings** | 6 tabs: Account, Appearance, Notifications, Voice & Video, Keybindings, Advanced |
| **Text Formatting** | mIRC codes on wire, markdown input, URL detection, link previews (Open Graph) |
| **Notifications** | Unread badges, mention badges, per-channel levels (all/mentions/nothing/mute), notification sounds, desktop notifications (Web Notification API) |
| **Keyboard Shortcuts** | Ctrl+K quick switcher, voice shortcuts, Alt+Up/Down channels, Ctrl+[/] servers |
| **IRC Protocol** | WebSocket, CAP negotiation, SASL, CHATHISTORY, MARKREAD, TAGMSG, message editing (REDACT + accord/edit), reconnect with backoff |
| **Auth** | JWT lifecycle, Tauri keyring + localStorage fallback, refresh tokens |
| **File Uploads** | Drag-drop, paste, 25MB limit, progress tracking, magic byte validation |
| **Server Config** | accord.json fetch, ETag caching with conditional re-validation, theme application, roles, categories, emoji, welcome modal |
| **Invites** | CRUD via accord-files API |
| **Desktop** | Tauri 2 build scripts, keyring integration, capabilities config |
| **Accessibility** | Keyboard nav, ARIA roles, focus trapping, `prefers-reduced-motion` |
| **Security** | Rate limiting, SSRF protection with DNS pinning, magic byte validation, structured security logging, JWT enforcement, admin auth middleware |
| **System Messages** | Join/part/quit/nick/mode, collapse 3+, configurable display level |
| **State Architecture** | 16 reactive Svelte 5 stores (including profiles), 500/channel ring buffer, msgid keying, edit chain maps |
| **User Profiles** | Backend: JSON file store, CRUD API, avatar upload with magic byte validation. Frontend: profile state store with fetch deduplication, Avatar component with lazy loading, profile editing in settings, bio/status display in popout |
| **Admin Panel** | Backend: admin auth middleware, stats/users/kick/ban/audit/announce API routes. Frontend: 4-tab admin panel (Dashboard, Users, Audit Log, Announce) with keyboard nav and a11y |
| **Threads** | Thread data model (threadId, getThread, walk-to-root), ThreadView sidebar component with auto-scroll and reply composition |
| **Edit History** | Edit history tracking in message store, "(edited)" label, edit history viewer UI |
| **Animations** | Message fade-in (100ms), channel crossfade (120ms), reaction scale pop, sidebar/modal transitions, speaking pulse, highlight-fade |
| **Documentation** | Backup & recovery guide, upgrade runbook with version pinning, nginx reverse proxy example with LiveKit UDP notes, admin setup guide |

---

## What's Missing

### Partial Implementations

| Area | What Works | What's Missing |
|------|------------|----------------|
| **Offline behavior** | Reconnection with backoff, localStorage for settings | No IndexedDB message cache, no service worker, no offline display |

### Explicitly Deferred (v2+, per spec)

Not part of the current work plan:

- Push notifications / PWA / service worker
- IndexedDB message cache
- E2EE for DMs
- Federation
- Plugin API / bot framework / webhooks
- Tauri mobile (iOS/Android)
- Multi-server (data model supports it, connection lifecycle doesn't)
- Offline compose queue
- Profile Layer 2 (Ed25519 signing, portable identity)

### Known Accepted Risks

From code review (see `.cardinal/code-review.md`):

| Item | Severity | Status |
|------|----------|--------|
| UserProfilePopout lacks focus trap | MEDIUM | Deferred — click-outside + Escape dismissal adequate |
| LiveKit channel membership not verified | MEDIUM | Accepted — blocked on Ergo API, mitigated by auth + rate limits |
| No cross-user profile tampering tests | MEDIUM | Deferred — auth middleware prevents at JWT level |
| `as any` casts for browser APIs (LiveKit, AudioContext) | LOW | Accepted — runtime APIs lack TS types |
| HTTPS TOCTOU window in SSRF prevention | LOW | Accepted — tiny window, requires DNS rebinding during TLS |

---

## Work Plan

All six phases complete.

| Phase | Status |
|-------|--------|
| Phase 1: Quick Wins (sounds, edit history, animations, ETag, search filters, desktop notifications) | Done |
| Phase 2: Profiles (backend store, API, avatar upload, client state, Avatar component, UI integration) | Done |
| Phase 3: Admin Panel (admin auth, API routes, 4-tab panel UI) | Done |
| Phase 4: Threads (data model, ThreadView component) | Done |
| Phase 5: Documentation (backup, upgrade, nginx, admin setup) | Done |
| Phase 6: Convergence & Polish (tests, code review, review fixes, cleanup) | Done |

---

## Verification Checklist

- [x] All client tests pass (`pnpm vitest run` in accord-client) — 922 tests
- [x] All server tests pass (`bun test` in accord-files) — 276 tests
- [ ] Server typecheck clean (`bunx tsc --noEmit` in accord-files)
- [ ] Client typecheck clean (`pnpm svelte-check` in accord-client)
- [ ] No console errors in browser
- [x] README updated for all public-facing behavior

---

## Architecture Notes for Profile System

Profiles live in the accord layer (client + accord-files), not in IRC. Ergo doesn't need to change.

```
Client                    accord-files              Ergo
  |                          |                        |
  |-- PUT /api/profile ----->|  Store in profiles.json |
  |                          |                        |
  |-- GET /api/profiles ---->|  Return all profiles   |
  |                          |                        |
  |-- POST /api/profile/avatar ->| Store in uploads/  |
  |                          |                        |
  |-- IRC PRIVMSG/JOIN etc --|----------------------->|  (unchanged)
```

Layer 2 (future) adds Ed25519 signing. The profile becomes a signed JSON blob. The public key IS the identity. Servers store profiles for their members. Cross-server identity is verified by key match, not by a central registry. Key backup via mnemonic phrase. This requires no protocol changes and no Ergo modifications.

---

## Current Numbers

| Metric | Value |
|--------|-------|
| Client tests | 922 |
| Server tests | 276 |
| Total tests | 1,198 |
| Test files | 49 |
| Svelte components | 30 |
| Reactive stores | 16 |
| IRC handler commands | 40+ |
| Docker services | 5 |
| Spec coverage | ~97% |
| Outstanding tasks | 0 (deferred items are v2+) |
