# virc TODO

Gaps between FRONTEND.md / PLAN.md specs and current implementation.
Excludes: S3/R2 storage, mobile layout, PWA/Service Worker, push notifications, IndexedDB offline cache.

---

## High Priority

### Virtual Scrolling
- [ ] MessageList: render only visible messages (~50 at a time) instead of all loaded messages
- [ ] Maintain scroll anchor when prepending history
- Spec: FRONTEND.md > Message Area > Scroll Behavior

### Message Hover Menu — Missing Actions
- [ ] Edit own message (from hover More menu, not just Up arrow)
- [ ] Copy Text
- [ ] Copy Link (message permalink)
- [ ] Mark Unread (set read marker to this message)
- Spec: FRONTEND.md > Hover Toolbar

### Server Settings Modal
- [ ] Overview tab (server name, icon upload, description, welcome message)
- [ ] Channels tab (create/edit/delete/reorder, set categories)
- [ ] Roles tab (map mode prefixes to names, set role colors)
- [ ] Members tab (list all, kick/ban, role assignment)
- [ ] Invites tab (generate links, set expiration, view active)
- [ ] Appearance tab (theme color overrides, preview)
- [ ] Moderation tab (auto-mod rules, banned words, slow mode per channel)
- Spec: FRONTEND.md > Modals & Overlays > Server Settings

---

## Medium Priority

### Resizable Columns
- [ ] Channel sidebar: drag handle, min 180px / max 360px, persist width
- [ ] Member list: drag handle, min 180px / max 300px, persist width
- Spec: FRONTEND.md > Column Widths

### Channel Sidebar Gaps
- [ ] Announcement/read-only channel type (pin icon for +m mode channels)
- [ ] Create channel `+` button next to category header (visible to ops)
- [ ] Server name dropdown that opens Server Settings modal
- Spec: FRONTEND.md > Channel Sidebar

### Member List Gaps
- [ ] Total member count header ("MEMBERS — 42")
- [ ] Hover card on member (mini user card without clicking)
- [ ] Right-click context menu: Kick, Ban, Mute, View Profile (permission-sensitive)
- Spec: FRONTEND.md > Member List

### Keyboard Shortcuts — Missing
- [ ] `Ctrl+[` / `Ctrl+]` — navigate servers (prev/next)
- [ ] `Ctrl+E` — toggle emoji picker
- [ ] `Shift+Escape` — mark channel as read
- [ ] `Page Up` / `Page Down` — scroll messages
- [ ] `Home` — jump to oldest loaded message
- [ ] `End` — jump to newest message
- Spec: FRONTEND.md > Keyboard Shortcuts

### Nick Coloring — Light Theme
- [ ] Use 40% lightness on light theme (currently always 65%)
- Spec: FRONTEND.md > Nick Coloring

### Mention Highlight on Messages
- [ ] Apply `--msg-mention-bg` and `--msg-mention-border` to messages that @mention current user
- Spec: FRONTEND.md > Message Anatomy

### Reaction Bar — Add Button
- [ ] `+` button at end of reaction row to add a new reaction via emoji picker
- [ ] Max 20 unique reactions per message, overflow scrolls horizontally
- Spec: FRONTEND.md > Reactions

### `/join` Slash Command
- [ ] Add `/join #channel` to SlashCommandMenu and MessageInput command handler
- Spec: FRONTEND.md > Message Input > Slash Commands

### User Profile Popout Gaps
- [ ] Registered date (from Ergo `/v1/ns/info` HTTP API)
- [ ] Avatar URL from `draft/metadata-2` account key
- [ ] Bio populated from server metadata
- Spec: FRONTEND.md > User Profile Popout

### User Settings Gaps
- [ ] Notifications tab (currently disabled/greyed out): per-server overrides, notification level defaults
- [ ] Account tab: email and password change fields
- Spec: FRONTEND.md > User Settings

### Server Config Integration Gaps
- [ ] `welcome.message` — show modal on first join (once per server, dismiss persisted)
- [ ] `welcome.suggested_channels` — clickable channel pills in welcome modal
- [ ] `roles.*.color` — override nick hash color in message rendering (currently only in member list)
- Spec: FRONTEND.md > Server Config Integration

### Header Bar
- [ ] Channel settings gear button (ops only)
- Spec: FRONTEND.md > Header Bar

---

## Low Priority

### Spoiler Formatting
- [ ] Input: `||text||` syntax
- [ ] Wire: `\x11[spoiler]\x11content\x11[/spoiler]\x11`
- [ ] Render: blurred until clicked
- Spec: FRONTEND.md > Text Formatting

### Code Block Syntax Highlighting
- [ ] Detect language hint in ` ```lang ` blocks
- [ ] Apply syntax highlighting to rendered code blocks
- Spec: FRONTEND.md > Text Formatting

### Theming Gaps
- [ ] User toggle to disable server themes (globally and per-server)
- [ ] Contrast ratio warning when server theme makes text unreadable (< 3:1)
- Spec: FRONTEND.md > Server-Owner Customization

### Server List Context Menu
- [ ] Right-click: server settings, mark as read, copy invite link, disconnect, remove
- Spec: FRONTEND.md > Server List

### Server List Reorder
- [ ] Drag to reorder servers, persist order locally
- Spec: FRONTEND.md > Server List

### Channel Sidebar — Drag Reorder
- [ ] Ops can drag-reorder channels within categories
- Spec: FRONTEND.md > Channel Sidebar

### Empty State — No Members Online
- [ ] Member list: "It's quiet... nobody else is online"
- Spec: FRONTEND.md > Empty States

### Image Loading
- [ ] Placeholder with correct aspect ratio (prevent layout shift)
- [ ] Blur-up transition on load
- Spec: FRONTEND.md > Loading States

### Ergo Config — Channel History Length
- [x] `channel-length` updated from 2048 to 4096 to match spec
- Spec: PLAN.md > Ergo Configuration

---

## Deviations (Intentional)

These differ from spec by design. Documented here so they aren't flagged again.

- **Font stack**: system fonts instead of Inter (avoids external font loading, native feel)
- **Font size preference**: 3 zoom levels (100/125/150%) instead of continuous 12-20px slider
- **Sidebar overlay breakpoint**: triggers at 900px (combines spec's 600-900px and <600px ranges)
- **Quick switcher**: global modal (Ctrl+K) instead of inline sidebar search bar
- **Caddy WebSocket path**: `/ws` instead of spec's `/irc/*`
