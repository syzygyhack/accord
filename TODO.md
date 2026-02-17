# virc TODO

Gaps between FRONTEND.md / PLAN.md specs and current implementation.
Excludes: S3/R2 storage, mobile layout, PWA/Service Worker, push notifications, IndexedDB offline cache.

---

## Remaining Gaps

### User Profile Popout — Data Sources
- [ ] Avatar URL from `draft/metadata-2` account key (prop exists, no data source wired)
- [ ] Bio populated from server metadata (prop exists, no data source wired)
- Spec: FRONTEND.md > User Profile Popout

### Accessibility (from code review)
- [ ] Focus trapping in modals (Settings, ServerSettings, WelcomeModal, etc.)
- [ ] Keyboard navigation in context menus (arrow keys, Enter, Escape)
- [ ] Keyboard alternative for drag-and-drop reorder (server list, channel list)
- [ ] ARIA tab patterns in Settings/ServerSettings tab navigation
- [ ] Focus management on dialog open (auto-focus first interactive element)
- Spec: FRONTEND.md > Accessibility

### Architecture Debt (from code review)
- [ ] Extract shared ContextMenu component (duplicated in ServerList, ChannelSidebar, MemberList, Message)
- [ ] Extract connection/voice logic from chat/+page.svelte (2100+ line god component)
- [ ] Virtual scrolling for member list (currently renders all members)
- Spec: .cardinal/code-review-final.md

### Image Loading — Aspect Ratio
- [ ] Placeholder with correct aspect ratio to prevent layout shift (blur-up transition is done)
- Spec: FRONTEND.md > Loading States

---

## Completed

### High Priority (all done)
- [x] Virtual scrolling — MessageList renders ~50 entries, prefix-sum offset cache, spacer divs
- [x] Message hover menu — Edit, Copy Text, Copy Link, Mark Unread all wired
- [x] Server Settings modal — all 7 tabs: Overview, Channels, Roles, Members, Invites, Appearance, Moderation

### Medium Priority (all done)
- [x] Resizable columns — ResizeHandle component, sidebar 180-360px, member list 180-300px, persisted
- [x] Channel sidebar — readonly pin icons, ops create channel button, server name dropdown
- [x] Member list — total count header, hover cards, right-click context menu (kick/ban/mute/profile)
- [x] Keyboard shortcuts — Ctrl+[/], Ctrl+E, Shift+Escape, PageUp/Down, Home, End
- [x] Nick coloring — 40% lightness on light theme, 65% on dark/amoled/compact
- [x] Mention highlight — `--msg-mention-bg` and `--msg-mention-border` applied
- [x] Reaction bar — '+' add button, overflow scrolling
- [x] `/join` slash command
- [x] User profile popout — registered date via Ergo API (`/v1/ns/info` proxy)
- [x] User Settings — Notifications tab, Account email/password change
- [x] Server config integration — welcome modal, suggested channels, role colors in messages
- [x] Header bar — channel settings gear button (ops only)

### Low Priority (all done)
- [x] Spoiler formatting — `||text||` input, mIRC wire format, blur-until-click render
- [x] Code block syntax highlighting — language detection, keyword/string/comment/number highlighting
- [x] Theming — server theme disable toggles (global + per-server), WCAG contrast warnings
- [x] Server list context menu — settings, mark read, copy invite link, disconnect, remove
- [x] Server list drag reorder — persisted to localStorage
- [x] Channel sidebar drag reorder — ops only, within categories
- [x] Empty state — "It's quiet... nobody else is online" in member list
- [x] Image blur-up — 10px blur → smooth unblur on load
- [x] Ergo config — `channel-length` updated to 4096

---

## Deviations (Intentional)

These differ from spec by design. Documented here so they aren't flagged again.

- **Font stack**: system fonts instead of Inter (avoids external font loading, native feel)
- **Font size preference**: 3 zoom levels (100/125/150%) instead of continuous 12-20px slider
- **Sidebar overlay breakpoint**: triggers at 900px (combines spec's 600-900px and <600px ranges)
- **Quick switcher**: global modal (Ctrl+K) instead of inline sidebar search bar
- **Caddy WebSocket path**: `/ws` instead of spec's `/irc/*`
