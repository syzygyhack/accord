# accord Frontend Design Reference

UI/UX specification for the accord client. Discord-inspired layout, IRC-rooted behavior, server-owner customizable.

---

## Design Principles

1. **Familiar but not cloned** — Users coming from Discord should feel at home. Users coming from IRC should feel respected. Don't copy Discord pixel-for-pixel; take what works and improve what doesn't.
2. **Information density is a feature** — IRC users value seeing more content, not less. Don't waste space on padding and decoration. Let users control density.
3. **Server owners are first-class** — Branding, theming, layout hints, and welcome experiences are configurable per-server without forking the client.
4. **Progressive disclosure** — Simple by default, powerful on demand. A new user sees a clean chat. A power user can enable compact mode, raw IRC output, keyboard-driven navigation.
5. **Cache-first mindset** — The client should feel instant. Cache aggressively. Reconnect silently. Never show a spinner when local data is available. Note: "offline-first" does not mean full offline functionality — accord is a real-time chat app and most features require a connection. See Offline Behavior section for what works without one.

---

## Layout

### Primary Structure: Three-Column

```
┌──┬─────────────┬──────────────────────────────────┬──────────────┐
│  │ CHANNEL      │ HEADER BAR                       │              │
│S │ SIDEBAR      │ #channel-name  | topic text...   │  MEMBER      │
│E │              ├──────────────────────────────────┤  LIST        │
│R │ ─ Text       │                                  │              │
│V │   #general   │                                  │  ── Admin    │
│E │   #dev       │  MESSAGE AREA                    │    @owner    │
│R │   #help      │                                  │  ── Mods     │
│  │ ─ Voice      │  [messages, virtual-scrolled]     │    @mod1     │
│L │   🔊 Lobby   │                                  │  ── Online   │
│I │     user1    │                                  │    user1     │
│S │     user2    │                                  │    user2     │
│T │              │                                  │              │
│  │              ├──────────────────────────────────┤              │
│  │              │ MESSAGE INPUT                    │              │
│  │              │ [text area + toolbar]             │              │
│  ├──────────────┼──────────────────────────────────┤              │
│  │ VOICE PANEL  │                                  │              │
│  │ (if active)  │                                  │              │
└──┴──────────────┴──────────────────────────────────┴──────────────┘
```

### Column Widths

| Column | Default | Min | Max | Resizable |
|--------|---------|-----|-----|-----------|
| Server list | 56px | 56px | 56px | No (fixed icon strip) |
| Channel sidebar | 240px | 180px | 360px | Yes (drag handle) |
| Message area | Fluid (fills remaining) | 400px | - | - |
| Member list | 240px | 180px | 300px | Yes (drag handle) |

### Responsive Breakpoints

| Width | Layout |
|-------|--------|
| > 1200px | All four columns visible |
| 900-1200px | Member list hidden (toggle via header button) |
| 600-900px | Channel sidebar becomes overlay (swipe or hamburger) |
| < 600px | Mobile: single column with navigation stack |

### Mobile Navigation

On mobile, the layout is a navigation stack:
1. **Server list** → tap server →
2. **Channel list** → tap channel →
3. **Chat view** (full screen) → swipe right for sidebar, header button for members

Back gestures (swipe right) navigate up the stack. No bottom tab bar — keep it simple.

---

## Color System

### Design Tokens (CSS Custom Properties)

accord uses a semantic token system. Server owners override tokens, not raw colors.

```css
/* Surface hierarchy (backgrounds) */
--surface-lowest:    /* Server list background */
--surface-low:       /* Channel sidebar background */
--surface-base:      /* Message area background */
--surface-high:      /* Elevated cards, dropdowns, modals */
--surface-highest:   /* Tooltips, popovers */

/* Text hierarchy */
--text-primary:      /* Main message text, headers */
--text-secondary:    /* Timestamps, metadata, labels */
--text-muted:        /* Disabled text, placeholders */
--text-link:         /* Clickable links */
--text-inverse:      /* Text on accent-colored backgrounds */

/* Interactive states */
--interactive-normal:    /* Default interactive element (button, link) */
--interactive-hover:     /* Hover state */
--interactive-active:    /* Active/pressed state */
--interactive-muted:     /* Disabled interactive element */

/* Accent / Brand */
--accent-primary:    /* Primary action buttons, active indicators, links */
--accent-secondary:  /* Secondary highlights */
--accent-bg:         /* Accent with low opacity, for selected states */

/* Status */
--status-online:     /* #23a559 — green */
--status-idle:       /* #f0b232 — amber */
--status-dnd:        /* #f23f43 — red */
--status-offline:    /* #80848e — gray */

/* Semantic */
--danger:            /* Destructive actions (kick, ban, delete) */
--warning:           /* Caution states */
--success:           /* Confirmation, positive actions */
--info:              /* Informational highlights */

/* Message-specific */
--msg-hover-bg:      /* Background on message hover */
--msg-mention-bg:    /* Background for messages that @mention you */
--msg-mention-border:/* Left border on mention messages */
```

### Built-in Themes

#### Dark (Default)
```css
:root[data-theme="dark"] {
  --surface-lowest:   #1a1a1e;
  --surface-low:      #1e1f24;
  --surface-base:     #27282d;
  --surface-high:     #2e3035;
  --surface-highest:  #383a40;
  --text-primary:     #e0e0e4;
  --text-secondary:   #9a9da3;
  --text-muted:       #5c5f66;
  --text-link:        #5b9ef0;
  --accent-primary:   #5b9ef0;
  --accent-bg:        rgba(91, 158, 240, 0.12);
  --danger:           #e04040;
  --success:          #3dba6c;
  --msg-hover-bg:     rgba(0, 0, 0, 0.06);
  --msg-mention-bg:   rgba(250, 180, 50, 0.08);
  --msg-mention-border: #f0b232;
}
```

#### Light
```css
:root[data-theme="light"] {
  --surface-lowest:   #e3e5e8;
  --surface-low:      #ebedef;
  --surface-base:     #ffffff;
  --surface-high:     #f2f3f5;
  --surface-highest:  #ffffff;
  --text-primary:     #1a1a1e;
  --text-secondary:   #5c5f66;
  --text-muted:       #9a9da3;
  --text-link:        #2563c4;
  --accent-primary:   #2563c4;
}
```

#### AMOLED
```css
:root[data-theme="amoled"] {
  --surface-lowest:   #000000;
  --surface-low:      #0a0a0a;
  --surface-base:     #111111;
  --surface-high:     #1a1a1a;
  --surface-highest:  #222222;
}
```

#### Compact / IRC Classic
A high-density theme inspired by traditional IRC clients:
```css
:root[data-theme="compact"] {
  /* Uses dark colors but with tighter spacing */
  --msg-padding-y: 1px;
  --msg-padding-x: 8px;
  --msg-font-size: 13px;
  --msg-line-height: 1.3;
  --msg-group-gap: 0;
  --nick-width: 120px; /* Fixed-width nick column */
  --show-avatars: none;
}
```

---

## Typography

```css
/* Font stack */
--font-primary: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;

/* Scale */
--font-xs:   11px;  /* Timestamps in compact mode */
--font-sm:   12px;  /* Metadata, labels, secondary text */
--font-base: 14px;  /* Message body, default text */
--font-md:   16px;  /* Channel names in sidebar, headers */
--font-lg:   20px;  /* Server name, large headings */
--font-xl:   24px;  /* Welcome screen headings */

/* Weights */
--weight-normal: 400;
--weight-medium: 500;
--weight-semibold: 600;
--weight-bold: 700;
```

### User Font Size Preference

Users can adjust base message font size (12px–20px). The scale adjusts proportionally. Stored client-side.

---

## Components

### Server List (Far Left Strip)

A vertical strip of circular icons, one per connected server.

```
┌────┐
│ Vi │  ← Server icon (image or 2-letter abbreviation)
├────┤
│ GG │  ← Unread: white dot left of icon
├────┤
│ OS │  ← Mention: red badge with count overlay
├────┤
│    │
│ +  │  ← "Add Server" button (opens join/connect modal)
└────┘
```

**Behaviors:**
- **Icon**: Server-provided image (from server metadata), or auto-generated 2-letter abbreviation from server name on a hashed-color background
- **Active indicator**: White pill-shaped bar on left edge (2px wide, 40px tall)
- **Hover indicator**: White pill bar, shorter (20px)
- **Unread indicator**: White dot on left edge (8px circle)
- **Mention badge**: Red circle overlaid on bottom-right of icon, white number text
- **Tooltip on hover**: Full server name
- **Reorderable**: Drag to reorder. Order persisted locally.
- **Right-click context menu**: Server settings, mark as read, copy invite link, disconnect, remove

### Channel Sidebar

```
┌─────────────────────────┐
│ Server Name          ▼  │  ← Server name + dropdown arrow (server settings)
├─────────────────────────┤
│ 🔍 Search / Jump to... │  ← Quick-switch search (Ctrl+K)
├─────────────────────────┤
│ ▼ TEXT CHANNELS         │  ← Category header (collapsible)
│   # general             │  ← Active channel: accent bg, bold text
│   # dev            (3)  │  ← Unread count badge
│   # help                │  ← Normal: text-secondary color
│   # off-topic           │
├─────────────────────────┤
│ ▼ VOICE CHANNELS        │
│   🔊 Lobby              │
│      ● user1            │  ← Voice participants shown inline
│      ● user2  🎤✕       │  ← Muted indicator
│   🔊 Gaming             │
├─────────────────────────┤
│ ▼ INFO                  │  ← Server-defined category
│   📌 rules              │  ← Read-only channel (announcement type)
│   📌 welcome            │
└─────────────────────────┘
```

**Channel list behaviors:**
- **Categories**: Collapsible. Server operator names them. Collapsed state persisted per-user.
- **Channel types** (visual prefix):
  - `#` — Text channel (default)
  - `🔊` — Voice channel (has inline participant list)
  - `📌` — Announcement/read-only channel (op-moderated mode +m)
- **Unread styling**: Channel name becomes white/bold (--text-primary). Unread count badge appears right-aligned.
- **Mention styling**: Channel name gets accent color. Badge shows mention count.
- **Active channel**: Accent background (--accent-bg). Bold text.
- **Hover**: Subtle background change (--surface-high).
- **Muted channels**: Italic text, dimmed. Unread indicators suppressed unless @mention.
- **Create channel**: "+" icon next to category header (visible to ops/admins).
- **Drag to reorder**: Ops can reorder channels within categories.
- **Right-click context menu**: Mute, notification settings, mark as read, copy link, edit channel (if op), leave.

### Header Bar

```
┌──────────────────────────────────────────────────────────────────────┐
│  # channel-name  │  Topic: Welcome to accord! Read the rules.  │  🔍 👥 📌 │
└──────────────────────────────────────────────────────────────────────┘
```

**Elements (left to right):**
1. **Channel icon + name** — `#` prefix for text, speaker for voice. Bold.
2. **Divider** — Thin vertical line.
3. **Topic** — Truncated to one line. Full topic on hover/click (expands). Editable by ops (click to edit, or `/topic` command).
4. **Spacer** (flexible)
5. **Action buttons** (right-aligned):
   - Search (magnifying glass) — Opens search panel
   - Member list toggle (people icon) — Shows/hides right sidebar
   - Pinned messages (pin icon) — Dropdown of pinned messages
   - Channel settings (gear, ops only)

### Message Area

This is the core of the app. Get it right.

#### Message Display Modes

**Cozy Mode (Default)** — Discord-style with avatars:
```
┌──────────────────────────────────────────────────────┐
│  [avatar]  Username              Today at 3:42 PM    │
│            Message text goes here. It can wrap to     │
│            multiple lines naturally.                  │
│                                                      │
│            Another message from the same user,        │
│            grouped (no avatar/name repeat).  3:43 PM  │
│                                                      │
│  [avatar]  OtherUser             Today at 3:45 PM    │
│            Their message here.                        │
│            👍 3  ❤️ 1  [+]                            │
└──────────────────────────────────────────────────────┘
```

**Compact Mode** — IRC-inspired, high density:
```
┌──────────────────────────────────────────────────────┐
│  3:42 PM  Username    Message text here              │
│  3:43 PM  Username    Another message                │
│  3:45 PM  OtherUser   Their message here             │
│                        👍 3  ❤️ 1  [+]               │
└──────────────────────────────────────────────────────┘
```

In compact mode:
- Timestamps on every line (left column, fixed width)
- Nicknames in a fixed-width column, right-aligned, colored by hash
- No avatars
- Minimal vertical spacing (1-2px between messages)
- **This is the mode IRC power users will want.** Make it good.

#### Message Anatomy (Cozy Mode)

```
┌─────────────────────────────────────────────────────────────┐
│                                          ┌─ HOVER TOOLBAR ─┐│
│  ┌────┐                                 │ 😀  ➜  ⋯  │   ││
│  │    │  Nickname          3:42 PM       └──────────────┘   │
│  │ AV │  ┌────────────────────────────────────────┐         │
│  │    │  │ ┌─ REPLY PREVIEW (if reply) ──────────┐│         │
│  └────┘  │ │↩ OriginalUser: quoted text trunca...││         │
│          │ └─────────────────────────────────────┘│         │
│          │                                        │         │
│          │ Message body text. Can contain:        │         │
│          │ **bold**, *italic*, `code`, links,     │         │
│          │ @mentions, #channel-refs, :emoji:      │         │
│          │                                        │         │
│          │ ┌─ ATTACHMENT (if file) ──────────────┐│         │
│          │ │  [image preview / file card]        ││         │
│          │ └────────────────────────────────────┘│         │
│          │                                        │         │
│          │ ┌─ LINK PREVIEW (if URL) ────────────┐│         │
│          │ │  Site Name                          ││         │
│          │ │  Page Title                         ││         │
│          │ │  Description text...                ││         │
│          │ │  [thumbnail]                        ││         │
│          │ └────────────────────────────────────┘│         │
│          └────────────────────────────────────────┘         │
│                                                             │
│  👍 3  ❤️ 1  🎉 2  [+]   ← REACTION BAR                    │
│                                                             │
│ ─ ─ ─ ─ ─  NEW MESSAGES  ─ ─ ─ ─ ─   ← UNREAD DIVIDER     │
└─────────────────────────────────────────────────────────────┘
```

#### Message Grouping

Consecutive messages from the same user within **7 minutes** are grouped:
- Only the first message shows avatar + username + full timestamp
- Subsequent messages show only the text, with a hover-reveal short timestamp on the left

A new group starts when:
- Different user sends a message
- More than 7 minutes between messages
- A system event intervenes (join, part, mode change)
- The message is a reply (always shows full header with reply preview)

#### Hover Toolbar

Appears top-right of the message on hover. Floats above the message boundary.

```
┌──────────────────────────┐
│  😀  ➜  ⋯               │
│  React  Reply  More      │
└──────────────────────────┘
```

Buttons:
- **React** (smiley face) — Opens emoji picker anchored to this message
- **Reply** (arrow) — Activates reply mode in input
- **More** (three dots) — Context menu: Edit, Delete, Pin, Copy Text, Copy Link, Mark Unread

The toolbar should NOT obscure message text. Position it so it overlaps the message above, not the current one.

#### Reactions

Displayed as a row of pill-shaped badges below the message:

```
┌─────────┐ ┌─────────┐ ┌───┐
│ 👍  3   │ │ ❤️  1   │ │ + │
└─────────┘ └─────────┘ └───┘
```

- Each pill: emoji + count
- Your own reactions: highlighted border (--accent-primary)
- Click to toggle your reaction on/off
- Hover on pill: tooltip shows who reacted
- `+` button: opens emoji picker to add a new reaction
- Max display: 20 unique reactions per message. Overflow scrolls horizontally.

#### Unread Divider

A horizontal rule with centered text:

```
──────── NEW MESSAGES ────────
```

Colored with --accent-primary or --danger (if mentions). Positioned at the first unread message based on MARKREAD state. Disappears after the user scrolls past it and the channel is marked as read.

#### Scroll Behavior

- **Default**: Anchored to bottom (newest messages). New messages auto-scroll into view.
- **Scrolled up**: "Jump to Present" pill appears, floating above the input. Shows unread count badge.
- **Scroll up to load history**: When near top, fetch older messages via `CHATHISTORY BEFORE`. Show a subtle loading skeleton (not a spinner).
- **Scroll position preservation**: When prepending history, maintain scroll position so content doesn't jump.

#### System Messages

Join, part, quit, nick changes, mode changes — rendered inline but visually distinct:

```
→ user1 has joined #general
← user2 has left #general (Quit: bye)
✦ user3 is now a channel operator
```

- Use --text-muted color
- Compact, single line
- **Collapsible**: If 3+ system messages occur consecutively, collapse into "N events" with expand toggle
- **Configurable**: User can hide all system messages, show all, or show joins/parts only for users who spoke recently

### Message Input

```
┌───────────────────────────────────────────────────────────────┐
│ ┌─ REPLY PREVIEW (if replying) ────────────────────── ✕ ─┐  │
│ │ Replying to Username: message preview text...           │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
│ ┌─ ATTACHMENT PREVIEW (if files staged) ────────────── ✕ ─┐ │
│ │ [thumb] filename.png (2.4 MB)                           │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ [+] │ Message #general...                        │ 😀 │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
│ [B] [I] [S] [~] [<>] [||]     ← Formatting toolbar (opt.) │
└───────────────────────────────────────────────────────────────┘
```

**Input behaviors:**
- **Auto-growing textarea**: Starts at 1 line. Grows up to 10 lines. Scrolls internally beyond that.
- **Enter to send**: Enter sends the message. Shift+Enter inserts a newline.
- **Tab completion**: Type `@` → autocomplete user list. Type `#` → autocomplete channels. Type `:` → autocomplete emoji. Type `/` → autocomplete commands.
- **File upload**: Click `+` button or drag-and-drop onto the message area. Paste from clipboard (Ctrl+V with image). Preview appears above input before sending.
- **Emoji picker**: Click smiley icon. Searchable grid. Recent/frequently used section at top. Custom server emoji section.
- **Typing indicator**: Below input, left-aligned: "Username is typing..." or "Username and OtherUser are typing..." or "Several people are typing..."
- **Slash commands**: `/` prefix triggers command autocomplete:
  - `/me <action>` — Action message (CTCP ACTION)
  - `/join #channel` — Join channel
  - `/part` — Leave current channel
  - `/topic <text>` — Set channel topic
  - `/msg <user> <text>` — Send DM
  - `/whois <user>` — Show user info
  - `/kick <user> [reason]` — Kick user (ops)
  - `/ban <user> [reason]` — Ban user (ops)
  - `/mute <user>` — Mute user (ops)

**Formatting toolbar** (optional, hidden by default, toggle in settings):
- Bold, Italic, Strikethrough, Code, Code Block, Spoiler
- Maps to mIRC formatting codes on send (see Formatting Strategy section — no custom tags)

### Member List (Right Sidebar)

```
┌──────────────────────┐
│ MEMBERS — 42         │
├──────────────────────┤
│ ▼ Admins — 2         │
│   ● ServerOwner      │
│   ● Admin2           │
├──────────────────────┤
│ ▼ Moderators — 3     │
│   ● Mod1             │
│   ● Mod2             │
│   ◑ Mod3  (idle)     │
├──────────────────────┤
│ ▼ Online — 28        │
│   ● User1            │
│   ● User2            │
│   ...                │
├──────────────────────┤
│ ▼ Offline — 9        │
│   ○ OfflineUser1     │
│   ○ OfflineUser2     │
└──────────────────────┘
```

**Behaviors:**
- **Role groups**: Based on IRC channel mode prefixes mapped to named roles:
  - `~` (founder) → "Owner"
  - `&` (admin) → "Admin"
  - `@` (op) → "Moderator"
  - `%` (halfop) → "Helper" (or server-configurable name)
  - `+` (voice) → "Member" (or server-configurable)
  - No mode → "Online" / "Offline"
- **Presence dots** (reconciling IRC AWAY status with always-on mode):
  - `●` Green — Online: user has at least one active connection AND is not AWAY
  - `◑` Amber — Idle: user is AWAY (auto-set by Ergo when always-on with no connections, or manually set by user). Display text: AWAY reason if set, or "Idle"
  - `●` Red — Do Not Disturb: user is AWAY with reason starting with `[DND]` (accord convention, e.g., `AWAY :[DND] Focusing`)
  - `○` Gray — Offline: user's always-on session has expired, or user has no always-on mode and is disconnected. Note: with always-on enabled (default), users are never truly "offline" — they transition to Idle when no clients are connected. The "Offline" group only shows users whose always-on sessions have expired or who have opted out of always-on.
- **Hover card**: On hover, show a mini user card (username, account name, role, join date, custom status)
- **Click**: Opens full user profile popout
- **Right-click**: DM, Mention, Kick, Ban, Mute, View Profile (context-sensitive to your permissions)
- **Sort**: Within each role group, sort alphabetically

### Voice Panel

When connected to a voice channel, a small panel appears at the bottom of the channel sidebar:

```
┌─────────────────────────┐
│ 🔊 Lobby                │
│ Connected • 00:42:15    │
├─────────────────────────┤
│  [🎤] [🎧] [📹] [📺] [📞] │
│  Mic  Deaf  Cam Share Hang │
└─────────────────────────┘
```

**Controls:**
- **Mute toggle** (microphone icon): Toggles mic. Red slash when muted.
- **Deafen toggle** (headphones icon): Mutes all incoming audio. Also mutes your mic.
- **Camera toggle** (camera icon): Start/stop camera video. Accent color when active.
- **Screen share** (monitor icon): Start/stop screen sharing. Accent color when active.
- **Disconnect** (phone icon, red): Leave voice channel.
- **Click channel name**: Expands to show full voice overlay / participant list.

### Voice Overlay (Expanded)

When a voice channel is active, clicking it (or an optional hotkey) shows a larger overlay:

```
┌───────────────────────────────────┐
│  🔊 Lobby                    ✕   │
├───────────────────────────────────┤
│  ┌──────┐  ┌──────┐  ┌──────┐   │
│  │      │  │      │  │      │   │
│  │ AV1  │  │ AV2  │  │ AV3  │   │
│  │      │  │      │  │      │   │
│  └──────┘  └──────┘  └──────┘   │
│  User1 🔊  User2 🎤✕  User3 🔊  │
├───────────────────────────────────┤
│   [🎤] [🎧] [📹] [📺] [📞]      │
└───────────────────────────────────┘
```

- **Speaking indicator**: Green ring around avatar when speaking
- **Video tiles**: Grid layout when video/screen sharing is active. Largest tile for the active speaker or screen share.
- **Participant list**: Names below avatars with status icons (muted, deafened, streaming)

### User Profile Popout

Triggered by clicking a username in the member list or a message.

```
┌───────────────────────────┐
│  ┌──────────────┐         │
│  │              │         │
│  │   AVATAR     │         │
│  │              │         │
│  └──────────────┘         │
│  DisplayName              │
│  @accountname             │
│                           │
│  ── About ──              │
│  User's bio text          │
│                           │
│  ── Roles ──              │
│  [Admin] [Moderator]      │
│                           │
│  ── Registered ──         │
│  Jan 15, 2026             │
│                           │
│  [Send Message]           │
└───────────────────────────┘
```

Fields sourced from:
- **Avatar**: Uploaded via accord-files profile API (`POST /api/profile/avatar`)
- **Display name**: Profile `displayName` field (from accord-files profile API)
- **Account name**: IRC account name (via `account-tag`)
- **Bio**: Profile `bio` field (from accord-files profile API)
- **Roles**: Derived from channel modes in the current channel
- **Registered**: Account registration date, available via Ergo's HTTP API (`/v1/account_details`). Note: IRC does not track "member since" (channel join time) — Ergo only stores account registration time. The field is labeled "Registered" not "Member Since" to be accurate.

### Modals & Overlays

#### Server Settings (Owner/Admin)

Accessed via server name dropdown in channel sidebar. Tabs:

| Tab | Contents |
|-----|----------|
| **Overview** | Server name, icon upload, description, welcome message |
| **Channels** | Create/edit/delete/reorder channels. Set categories. |
| **Roles** | Map IRC mode prefixes to named roles. Set role colors. Configure role-specific permissions text descriptions. |
| **Members** | List all members. Kick/ban controls. Role assignment. |
| **Invites** | Generate invite links. Set expiration. View active invites. |
| **Appearance** | Theme color overrides (accent, surfaces). Preview before applying. |
| **Moderation** | Auto-mod rules. Banned words. Slow mode per channel. |

#### User Settings

Accessed via gear icon near the voice panel or user avatar.

| Tab | Contents |
|-----|----------|
| **Account** | Username card, profile (bio, avatar upload), password change. Sticky save bar appears when profile fields are modified. |
| **Appearance** | Theme (dark/light/amoled/compact). Font size. Message density. |
| **Notifications** | Default notification level. Per-server overrides. Push notification toggle. |
| **Voice & Video** | Input/output device selection. Volume. Noise suppression toggle. |
| **Keybindings** | Customizable keyboard shortcuts |
| **Advanced** | Show raw IRC messages (debug panel). Enable developer mode. |

---

## Server-Owner Customization

This is a key differentiator. Server owners should be able to brand their community without shipping a custom client.

### What Server Owners Can Customize

| Property | How It's Stored | Where It Appears |
|----------|-----------------|------------------|
| **Server display name** | `/.well-known/accord.json` → `name` (display name, e.g., "My Community"). Falls back to Ergo's `server.name` (hostname) if accord.json is unavailable. | Server list tooltip, sidebar header |
| **Server icon** | `/.well-known/accord.json` → `icon` | Server list icon |
| **Server description** | `/.well-known/accord.json` → `description` | Server invite page, welcome modal |
| **Welcome message** | `/.well-known/accord.json` → `welcome.message` | Shown to users on first join |
| **Channel categories** | `/.well-known/accord.json` → `channels.categories` | Sidebar groupings (decorative) |
| **Role names** | `/.well-known/accord.json` → `roles` | Member list, profile cards (decorative) |
| **Role colors** | `/.well-known/accord.json` → `roles.*.color` | Nick color in messages, role badge (decorative) |
| **Accent color** | `/.well-known/accord.json` → `theme.accent` | --accent-primary override |
| **Theme colors** | `/.well-known/accord.json` theme object | CSS variable overrides only (no arbitrary CSS) |
| **Custom emoji** | `/.well-known/accord.json` → `emoji`, assets on accord-files | Emoji picker, inline rendering |
| **Slow mode** | Channel mode (rate limit) | Input shows cooldown timer |

### Theme Override Mechanism

Server-provided theme overrides are **CSS custom property values only** — not arbitrary CSS. The server config provides color values, and the client applies them as variable overrides.

```css
/* Client-side: apply server theme as variable overrides */
:root[data-server="chat.mycommunity.com"] {
  --accent-primary: var(--server-accent, var(--accent-primary));
  --surface-lowest: var(--server-surface-lowest, var(--surface-lowest));
  /* ... only design token overrides, no arbitrary selectors */
}
```

**Why not arbitrary CSS?** Sanitizing CSS securely is extremely hard. Malicious CSS can:
- Overlay fake UI elements to phish credentials
- Exfiltrate data via `url()` in `background-image` with query params
- Break interactive elements with `pointer-events: none`
- Resize/hide security-relevant UI

**What server owners CAN customize** (via `/.well-known/accord.json` theme object):
- Any design token value from the Color System section (surfaces, text colors, accent, etc.)
- That's it. No selectors, no properties beyond color values.

**User controls:**
- User can disable server themes globally or per-server
- User's own theme (dark/light/amoled/compact) is always the base; server overrides layer on top
- If a server theme makes text unreadable (contrast ratio < 3:1), client warns and offers to disable

### Server Config Format

Served at `GET https://<server>/.well-known/accord.json` by accord-files. See PLAN.md: Server Config Discovery for the full schema. The frontend consumes this config as described in the Server Config Integration section below.

---

## Keyboard Shortcuts

### Global

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Quick switch (search channels/DMs/servers) |
| `Ctrl+Shift+M` | Toggle mute (voice) |
| `Ctrl+Shift+D` | Toggle deafen (voice) |
| `Ctrl+Shift+V` | Toggle camera (voice) |
| `Ctrl+Shift+S` | Toggle screen share (voice) |
| `Alt+Up/Down` | Navigate channels (prev/next) |
| `Alt+Shift+Up/Down` | Navigate unread channels |
| `Ctrl+[` / `Ctrl+]` | Navigate servers (prev/next) |
| `Escape` | Close modal/overlay, cancel reply, deselect |
| `Ctrl+,` | Open user settings |

### Message Area

| Shortcut | Action |
|----------|--------|
| `Up arrow` (empty input) | Edit your last message |
| `Ctrl+E` | Toggle emoji picker |
| `Ctrl+Shift+F` | Focus search |
| `Shift+Escape` | Mark channel as read |
| `Page Up / Page Down` | Scroll messages |
| `Home` | Jump to oldest loaded message |
| `End` | Jump to newest message |

### Input

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line |
| `Tab` | Cycle autocomplete |
| `Ctrl+B` | Bold (wraps selection in `**`) |
| `Ctrl+I` | Italic (wraps selection in `*`) |
| `Ctrl+Shift+C` | Code (wraps selection in backticks) |
| `Ctrl+V` | Paste (auto-detects images → upload) |

All shortcuts are remappable via User Settings > Keybindings.

---

## Nick Coloring

Consistent, deterministic nick colors so each user is always the same color.

**Algorithm:**
1. Hash the account name (not display name) with a fast hash (djb2 or similar)
2. Map to a hue value (0-360)
3. Apply fixed saturation (65%) and lightness (65% dark theme, 40% light theme)
4. Result: `hsl(hash % 360, 65%, 65%)`

**Override**: If a user has a role with a configured color (set by server owner), the role color takes priority over the hash color. Highest-ranked role wins.

**Compact mode**: Nick colors are especially important here — they're the primary way to visually distinguish speakers without avatars.

---

## Text Formatting

### Formatting Strategy

**Single source of truth: mIRC formatting codes on the wire.** No ambiguity.

The client uses markdown-like syntax in the input box for convenience, but **always converts to mIRC control codes before sending**. On the receiving side, the client always renders mIRC codes — regardless of what client sent them.

This means:
- accord ↔ accord: Full formatting works
- accord → HexChat/irssi: Formatting works (they understand mIRC codes)
- HexChat → accord: Formatting works (accord renders mIRC codes)
- No dual-rendering bugs, no format detection heuristics

| User Types (Input) | Wire (IRC) | Rendered |
|-----------|------------|----------|
| `**bold**` | `\x02bold\x02` | **bold** |
| `*italic*` | `\x1Ditalic\x1D` | *italic* |
| `~~strike~~` | `\x1Estrike\x1E` | ~~strike~~ |
| `` `code` `` | `\x11code\x11` | `code` |
| `\|\|spoiler\|\|` | `\x11[spoiler]\x11content\x11[/spoiler]\x11` | Blurred until clicked (accord-only; other clients see `[spoiler]content[/spoiler]`) |
| ` ```code block``` ` | `draft/multiline` batch with `\x11` wrapping | Syntax-highlighted block |

**No custom format tags.** We do not send a `+accord/format=markdown` tag. The wire format is always mIRC codes. This avoids the entire class of "which format is this message in?" bugs.

### URL Detection

Auto-linkify URLs in message text. Render inline previews for:
- **Images** (jpg, png, gif, webp): Inline thumbnail, click to expand
- **Videos** (mp4, webm): Inline player with controls
- **Audio** (mp3, ogg, flac): Inline player bar
- **Other URLs**: Open Graph preview card (title, description, thumbnail) fetched by accord-files or client-side

### @Mentions and #Channels

- `@username` → Highlighted with accent bg, clickable (opens profile)
- `#channel` → Clickable link, navigates to channel
- `@here` / `@everyone` → Highlight the message with --msg-mention-bg. These map to targeting all users in channel.

---

## Notifications

### In-App

| Event | Indicator |
|-------|-----------|
| Unread messages | White channel name, unread count badge |
| @mention | Channel name in accent color, mention count badge, message highlighted |
| DM | Server list DM icon badge, notification toast |
| Voice activity | "User joined your voice channel" toast (optional) |

### System Notifications (OS-level)

- **Desktop (Tauri)**: Native OS notifications via Tauri API
- **Browser**: Notification API + Service Worker for background
- **Mobile PWA**: Web Push via VAPID

### Per-Channel Notification Settings

Users can set per-channel:
- **All messages**: Notify on every message
- **Mentions only** (default): Notify only on @mention, @here, @everyone
- **Nothing**: No notifications
- **Mute**: Suppress all indicators including unread badges

---

## Animations & Transitions

Keep it subtle and functional. No gratuitous animation.

| Element | Animation | Duration |
|---------|-----------|----------|
| New message appearing | Fade in + slight slide up | 100ms |
| Channel switch | Content crossfade | 120ms |
| Modal open/close | Fade + scale (0.95 → 1.0) | 150ms |
| Sidebar collapse/expand | Slide | 200ms |
| Tooltip appear | Fade in | 80ms, 300ms delay |
| Reaction badge add | Scale pop (1.0 → 1.1 → 1.0) | 200ms |
| Hover toolbar | Fade in | 80ms |

Users can disable all animations via Settings > Appearance > Reduce Motion. Respects `prefers-reduced-motion` OS setting automatically.

---

## Accessibility

- **Full keyboard navigation**: All interactive elements reachable via Tab. Focus rings visible.
- **Screen reader support**: ARIA roles on all major landmarks. Live regions for new messages. Alt text on images.
- **Color contrast**: All text meets WCAG 2.1 AA (4.5:1 ratio minimum). Test themes against this.
- **Focus management**: When switching channels, focus moves to the message input. When opening a modal, focus is trapped inside.
- **Prefers-reduced-motion**: Disable all transitions/animations.
- **Prefers-color-scheme**: Auto-detect dark/light preference on first launch.
- **Minimum touch targets**: 44x44px on mobile for all interactive elements.

---

## State Architecture (Svelte 5)

```
lib/state/
├── appSettings.svelte.ts    ← User preferences (density, font size, formatting toolbar)
├── audioSettings.svelte.ts  ← Audio device selection, volumes, noise suppression
├── channels.svelte.ts       ← Channel lists per server, active channel, DM conversations
├── connection.svelte.ts     ← WebSocket connection state per server
├── members.svelte.ts        ← Member lists per channel, role groups
├── messages.svelte.ts       ← Message buffers per channel (ring buffer, 500 local)
├── notifications.svelte.ts  ← Unread counts, mention counts per channel
├── presence.svelte.ts       ← Online/idle/DND/offline status via MONITOR + away-notify
├── profiles.svelte.ts       ← User profiles (display name, bio, avatar) with fetch dedup
├── rawIrcLog.svelte.ts      ← Raw IRC message log for debug panel
├── serverConfig.svelte.ts   ← Server config (accord.json) with ETag caching
├── servers.svelte.ts        ← Server list, active server
├── theme.svelte.ts          ← Active theme, server theme overrides
├── typing.svelte.ts         ← Typing indicator state per channel
├── user.svelte.ts           ← Current user state (nick, account, auth)
└── voice.svelte.ts          ← Voice connection state, participants
```

Each file exports reactive state using Svelte 5 runes (`$state`, `$derived`). No external state library needed.

### Message Buffer Strategy

- Keep last 500 messages per channel in memory (ring buffer)
- Older messages evicted from memory, re-fetched via CHATHISTORY on scroll
- IndexedDB cache for offline access (last 200 messages per channel)
- Messages keyed by `msgid` for deduplication and reaction/edit targeting

---

## Empty States

Every empty state should be helpful, not just blank:

| State | What to Show |
|-------|-------------|
| No servers | "Add a server to get started" + Add Server button |
| No channels | "This server has no channels you can see" |
| Empty channel | "This is the beginning of #channel-name. Say something!" |
| No search results | "No messages matched your search" |
| No members online | "It's quiet... nobody else is online" |
| Disconnected | "Reconnecting..." with subtle pulse animation. Auto-retry. |

---

## Loading States

- **Initial connection**: Full-screen branded splash (server icon + name + spinner). Transition to chat once first channel loads.
- **Channel switch**: Instant if messages are cached. Brief skeleton (3-4 placeholder message shapes) if fetching.
- **History load (scroll up)**: Subtle skeleton rows at top of message list. No blocking spinner.
- **File upload**: Progress bar in attachment preview above input. Percentage text.
- **Image loading**: Placeholder with correct aspect ratio (prevents layout shift). Blur-up transition on load.

---

## Error States

- **Connection lost**: Yellow banner at top of message area: "Connection lost. Reconnecting..." Auto-dismiss on reconnect.
- **Message send failure**: Red indicator on the message. "Failed to send" with retry button.
- **File upload failure**: Red badge on attachment preview. "Upload failed" with retry.
- **Auth failure**: Modal: "Session expired. Please log in again."
- **Rate limited**: Input briefly disabled. "Slow down! You can send another message in Xs."

---

## Offline Behavior

accord is a real-time chat app — most features require a connection. "Cache-first" means the app loads instantly from local data, not that it works offline like a document editor.

### What Works Offline

| Feature | Offline Behavior |
|---------|-----------------|
| **App shell** | Loads from Service Worker cache. No network needed to show the UI. |
| **Recent messages** | Last 200 messages per channel cached in IndexedDB. Displayed read-only. |
| **Channel list** | Cached from last session. Displayed with stale data indicator. |
| **User settings** | Fully local. All preferences work offline. |
| **Theme** | Fully local. Renders correctly. |

### What Requires Connection

| Feature | Offline State |
|---------|--------------|
| **Sending messages** | Input disabled. "You're offline. Reconnecting..." |
| **Loading older history** | "Connect to load more messages" |
| **File uploads** | Disabled |
| **Voice/video** | Disabled |
| **Reactions** | Disabled (optimistic UI not worth the complexity for v1) |
| **User presence** | Stale. All users show last known state. |
| **Search** | Disabled (server-side) |

### Reconnection

- Auto-reconnect with exponential backoff (1s, 2s, 4s, 8s, max 30s)
- On reconnect: `CHATHISTORY` fills the gap, `MARKREAD` syncs read state
- No message queue / outbox for v1. Messages are not composed offline and sent later. This avoids complexity around ordering, deduplication, and conflict resolution.

### Future (v2+)

- Offline compose queue (type a message offline, send on reconnect)
- Attachment queue (stage files offline, upload on reconnect)
- Full IndexedDB message cache with search

---

## Server Config Integration

The frontend fetches `/.well-known/accord.json` from the server (see PLAN.md: Server Config Discovery) and applies it to the UI. Here is how each config property maps to frontend behavior:

| Config Field | Frontend Effect |
|-------------|----------------|
| `name` | Display name shown in server list tooltip and sidebar header. Falls back to Ergo hostname (`server.name`) if accord.json unavailable. |
| `icon` | Server list icon image (falls back to 2-letter abbreviation if missing) |
| `description` | Shown in the "Add Server" / invite accept modal |
| `theme.accent` | Overrides `--accent-primary` CSS variable |
| `theme.surfaces.*` | Overrides `--surface-*` CSS variables |
| `roles.*.name` | Displayed in member list group headers and profile popouts instead of mode symbols |
| `roles.*.color` | Used as nick color override (takes priority over hash-based coloring) |
| `channels.categories` | Groups channels in the sidebar under named collapsible headers |
| `channels.*.voice` | Channels in this category show the voice icon and inline participant list |
| `emoji.*` | Added to the emoji picker under a "Server" tab. Rendered inline in messages as `<img>` |
| `welcome.message` | Shown in a modal on first join (once per server, dismissed = stored in localStorage) |
| `welcome.suggested_channels` | Displayed as clickable channel pills in the welcome modal |

**Cache strategy**: Fetched on first connection. Stored in localStorage with ETag. Re-validated on each reconnect (conditional GET). Stale config is used immediately while fresh config loads in background.
