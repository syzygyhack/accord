# How accord Was Built

The codebase was authored by **Claude Opus 4.6** (Anthropic) running inside the **Avril** harness — a session-based agent framework for quality-assured code generation. Work was orchestrated by **Cardinal**, a task planning and execution system that decomposed design specs into implementable work units, managed dependencies, and tracked progress.

Three Cardinal sessions built the project end-to-end:

## Session 1: Core MVP (Feb 12)
Cardinal decomposed the specs into **36 tasks** ordered by dependency graph: Docker infrastructure first, then IRC protocol layer, then UI shell, then features.

Delivered: Docker Compose stack (Ergo, MariaDB, LiveKit, Caddy), SvelteKit project scaffolding, IRC parser/connection/CAP/SASL, all core UI components (Login, Message, MessageList, MessageInput, MemberList, ChannelSidebar, HeaderBar), voice state and LiveKit room management, read markers, unread badges, DM conversations, reconnection with gap fill, responsive layout, and the Tauri desktop shell.

## Session 2: Feature Completion (Feb 15)
Cardinal planned **22 tasks** to close all remaining spec gaps.

Delivered: message editing with `+accord/edit` tag, file upload backend and client UI (drag-and-drop, paste-to-upload), inline media previews (image/video/audio), Open Graph link preview cards with SSRF-protected server-side fetch, four themes (dark/light/AMOLED/compact), compact message display mode, per-channel notification settings, invite link system (create/validate/expire/revoke), server list sidebar with drag reorder, user profile popout, collapsible system messages, custom server emoji, pinned messages, message search panel, keybinding customization UI, raw IRC debug panel, and a full code review pass.

## Session 3: Polish & Review (Feb 16-17)
Cardinal planned **31 tasks** targeting the remaining TODO items and a comprehensive code review.

Delivered: `/join` slash command, member list virtual scrolling and hover cards, server list context menu, message hover menu (edit/copy/mark unread), Server Settings modal (7 tabs), User Settings Notifications and Account tabs, user profile popout with registered date, resizable sidebar columns, channel sidebar ops affordances (create button, drag reorder, read-only icons), header bar channel settings gear, reaction bar improvements, keyboard shortcuts, server config integration (welcome modal, role colors), spoiler formatting, syntax-highlighted code blocks, empty states and image blur-up transitions, shared constant deduplication, and two rounds of code review fixes (security, performance, accessibility, CSS).

## Post-Cardinal
Development continued as **human-agent collaboration** — the human directed priorities and reviewed results while Claude (Opus 4.6 via Avril) implemented features and fixes. Cross-model review (**Claude + OpenAI Codex**) identified issues including MODE parsing drift, MONITOR timing races, and slash command edge cases, all resolved. Post-Cardinal work added: voice manager extraction, accessibility utilities (focus trapping, menu keyboard navigation, ARIA tab patterns), channel navigation module, server theme disable toggles, WCAG contrast warnings, and a comprehensive TODO rewrite for the rename/publish roadmap.

## Session 4: Security Audit & Hardening (Feb 18)
A full codebase security audit identified 16 findings across the stack. Fixes applied: JWT secret minimum length enforcement, structured security event logging for all auth/upload/invite/account operations, dedicated MariaDB user isolation, og:image SSRF validation, magic byte file upload validation, HSTS headers, removal of insecure defaults from environment configuration, case-insensitive IRC key normalization, mIRC 99-color palette support, voice disconnect handling, and expanded test coverage (+82 tests).

## Session 5: Spec Alignment (Feb 25)
Cardinal planned **12 tasks** to close remaining gaps between codebase and spec documents.

Delivered: notification sounds with volume control, desktop notifications (Web Notification API), edit history viewer with "(edited)" label, spec-required CSS animations (message fade-in, channel crossfade, reaction pop), ETag caching for server config, expanded search filters (`has:image`, `has:link`, `before:date`, `after:date`), profile backend (JSON file store, CRUD API, avatar upload with magic byte validation), profile frontend (state store with fetch deduplication, Avatar component, settings UI), admin backend (auth middleware, stats/users/kick/ban/audit/announce routes), admin panel UI (4 tabs with keyboard nav), operational documentation (backup guide, upgrade runbook, nginx config, admin setup), thread data model and ThreadView sidebar, code review, and final cleanup.

Post-session: typecheck fixes (duplicate property in profileStore.ts), a11y improvements (focus trapping in UserProfilePopout, dialog tabindex fixes), cross-user profile isolation tests, full offline mode — IndexedDB message cache with write-through, service worker with app shell caching, PWA manifest, navigator.onLine tracking with reactive UI banner, and graceful degradation when disconnected. Bug fixes: DM reactivity isolation (split `activeChannel` into standalone `$state` signal), profile update error reporting, file image preview layout, self-DM deduplication (msgid-based dedup in `addMessage` for echo+delivery), and channel-switch effect guard to prevent spurious virtualizer resets.

## Session 6: UX Polish (Feb 26)
Human-directed session focused on profile UX, scroll behavior, and infrastructure correctness.

Fixes: simplified account card to single username (removed displayName editing since Ergo enforces nick=account), WHOX for member list account resolution (bio now visible from member list clicks), Avatar component in UserPanel, image lightbox elevated to page level (escaped `contain:strict` in message list), per-channel scroll position persistence with continuous save, virtual scroll re-anchor on height changes, Ergo API compatibility (use `/v1/account_details` and `/v1/ns/passwd` instead of nonexistent `/v1/ns/info` and `/v1/ns/set`), removed unsupported email editing, Docker port exposure fix, and dead code cleanup.

## Session 7: Bug Fixes & CI (Feb 27)
Human-directed session focused on fixing user-reported bugs and adding CI/CD.

Bug fixes: message input focus outline removed, apostrophe HTML-escaping bug (`'` rendered as `&#39;`), LiveKit LAN voice connection failure (explicit `node_ip` + `use_external_ip: false`), DM sidebar alignment, voice speaking highlight spanning full width (`inline-flex` + `align-items: flex-start` on container). Cross-model review (Codex) identified `highlightMentions` corrupting URLs containing `@` or `#` by rewriting inside anchor tags — fixed by splitting HTML tags from text before running replacements.

CI/CD: added GitHub Actions workflows — `ci.yml` (client tests, typecheck, server tests on push/PR) and `build.yml` (Tauri cross-platform builds on manual dispatch with draft GitHub Release). Runner-focused review (Codex) identified 5 issues: `ubuntu-22.04-arm` unavailable (→ `ubuntu-24.04-arm`), `libwebkit2gtk-4.1-dev` missing on 22.04 arm64 (→ 24.04), Intel macOS cross-compile on ARM runner (→ `macos-13`), RPM build fails on Ubuntu (→ `--bundles deb,appimage`), unpinned Bun version (→ `1.3`). Also fixed `tauri.conf.json` `beforeBuildCommand` using `npm` instead of `pnpm`.

## By the Numbers

| Metric | Value |
|--------|-------|
| TypeScript + Svelte source | ~28,000 lines |
| Test code | ~13,700 lines |
| Design specs | ~1,860 lines |
| Infrastructure config | ~1,400 lines |
| Components | 31 |
| Reactive stores | 16 |
| Packages | 2 |
| Tests | 1,200+ |
| Cardinal tasks | 99+ |
