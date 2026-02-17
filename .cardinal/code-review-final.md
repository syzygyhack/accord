# Final Code Review

**Date:** 2026-02-17
**Scope:** Full codebase review of accord-client and accord-files
**Focus:** Code smells, accessibility, security, performance, styling consistency, error handling

---

## Table of Contents

1. [Critical Issues](#1-critical-issues)
2. [Security](#2-security)
3. [Accessibility](#3-accessibility)
4. [Architecture & Code Smells](#4-architecture--code-smells)
5. [Performance](#5-performance)
6. [Error Handling](#6-error-handling)
7. [CSS & Styling](#7-css--styling)
8. [Type Safety](#8-type-safety)
9. [Test Coverage Gaps](#9-test-coverage-gaps)
10. [Previously Deferred Items Status](#10-previously-deferred-items-status)

---

## 1. Critical Issues

### CR-F001: TOCTOU DNS Rebinding in SSRF Protection [HIGH]
**File:** `accord-files/src/routes/preview.ts:246-252`

`fetchUrl()` resolves hostname via `assertPublicResolution()` then makes a separate `fetch()`. Between these calls, a malicious DNS server can rebind the domain to a private IP, bypassing SSRF protection.

```typescript
await assertPublicResolution(currentParsed.hostname);
// DNS can rebind here
const res = await fetch(currentUrl, { ... });
```

**Fix:** Use resolved IP directly in fetch, or implement DNS pinning.

### CR-F002: Rate Limit Bypass via X-Forwarded-For Spoofing [HIGH]
**File:** `accord-files/src/middleware/rateLimit.ts:45-50`

When no reverse proxy is present, the entire `X-Forwarded-For` header is attacker-controlled. An attacker can set any IP to bypass rate limiting entirely.

```typescript
const forwarded = c.req.header("X-Forwarded-For");
const parts = forwarded?.split(",");
const ip = parts?.[parts.length - 1]?.trim() || ...
```

**Fix:** Add configuration flag for trusted proxy mode. When disabled, use only socket address.

### CR-F003: Unbounded Rate Limit Store Growth [HIGH]
**File:** `accord-files/src/middleware/rateLimit.ts:59-63`

Each unique IP creates an entry in the `Map` with no upper bound. An attacker rotating IPs can exhaust server memory. Cleanup only runs on incoming requests.

**Fix:** Cap `store.size` and reject when full, or use fixed-size data structure (e.g., token bucket with LRU).

---

## 2. Security

### CR-F004: `linkify()` Exported with XSS-Fragile Contract [MEDIUM]
**File:** `accord-client/src/lib/irc/format.ts:277`

`linkify()` is exported and documented as requiring pre-escaped input, but callers could easily misuse it on raw text. The display text path at line 303 inserts the URL without escaping because it assumes pre-escaped context.

**Recommendation:** Make `linkify()` private or add an internal safety escape.

### CR-F005: Invite Token Not URL-Encoded in Path [MEDIUM]
**File:** `accord-client/src/lib/api/invites.ts:77`

```typescript
const res = await fetch(`${baseUrl}/api/invite/${inviteToken}`, { ... });
```

If `inviteToken` contains path characters, this causes path traversal. Use `encodeURIComponent(inviteToken)`.

### CR-F006: OG Tag Values Returned Unsanitized [MEDIUM]
**File:** `accord-files/src/routes/preview.ts:230-236`

Parsed OG meta tags from external pages are returned as-is. If client renders `og:title` as HTML, this is a stored XSS vector.

### CR-F007: Missing IPv6 All-Zeros Check in SSRF Filter [MEDIUM]
**File:** `accord-files/src/routes/preview.ts:116-143`

`isPrivateHost()` checks for `::1`, `fe80:`, `fc00:`, `fd`, but not `::` (all-zeros, equivalent to `0.0.0.0`), `100::/64`, or `2001:db8::/32`.

### CR-F008: CSS Injection via Role Colors [LOW]
**Files:** `Message.svelte:604,609`, `MemberList.svelte:348`

Nick colors from `getRoleColor()` are injected directly into `style` attributes. If a compromised server config returns a string like `red; background-image: url(evil)`, this is CSS injection. Colors should be validated against a safe pattern.

### CR-F009: Minimum Password Length of 1 Character [LOW]
**File:** `accord-files/src/routes/account.ts:39-41`

```typescript
if (newPassword.length < 1) { ... }
```

Should enforce minimum 8 characters per standard security practices.

### CR-F010: All Invites Visible to Any Authenticated User [LOW]
**File:** `accord-files/src/routes/invite.ts:149-165`

`GET /api/invite` returns all invites including `createdBy` for any authenticated user. Consider scoping to own invites or requiring admin privileges.

### CR-F011: No Upload Quota Per User [LOW]
**File:** `accord-files/src/routes/files.ts`

No per-user upload limit. An authenticated user could upload thousands of files. Rate limiting (20/min) allows ~30GB/hour of uploads.

### CR-F012: No Global Request Body Size Limit [LOW]
**File:** `accord-files/src/index.ts`

No middleware limiting request body size. Malicious clients can send enormous JSON bodies to any endpoint.

---

## 3. Accessibility

### CR-F013: No Focus Traps in Modal Dialogs [HIGH]
**Files:** `ServerSettings.svelte:234`, `WelcomeModal.svelte:30`, `UserSettings.svelte`, `EmojiPicker.svelte`, `ChannelSidebar.svelte:517`, `chat/+page.svelte:1808`

All modals/dialogs use `aria-modal="true"` but implement no focus trapping. Users can Tab out of dialogs into background content. This violates the ARIA modal contract and WCAG 2.4.3 (Focus Order).

**Affected components:** ServerSettings, WelcomeModal, UserSettings, EmojiPicker, ChannelSidebar (create channel dialog), chat page (delete dialog).

### CR-F014: No Focus Management on Dialog Open [HIGH]
**Files:** All modal components listed above

Dialogs never receive programmatic focus when opened. The `tabindex="-1"` attribute is present but `.focus()` is never called. Screen reader users and keyboard users cannot discover the dialog.

### CR-F015: Missing ARIA Tab Pattern [HIGH]
**Files:** `ServerSettings.svelte:240-262`, `UserSettings.svelte`

Tab navigation uses visual `.active` class but no ARIA attributes. Missing: `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, `aria-controls`, `aria-labelledby`.

### CR-F016: Textarea Missing Focus Ring [HIGH]
**File:** `MessageInput.svelte:1012`

```css
textarea { outline: none; }
```

Focus ring removed with no replacement. Violates WCAG 2.4.7 (Focus Visible). Add `:focus-visible` styling.

### CR-F017: No Landmark Roles in Main Layout [HIGH]
**File:** `chat/+page.svelte:1657-1786`

The layout has no `<main>`, `<nav>`, `<aside>`, or `<header>` landmarks. Screen reader users cannot navigate by region.

### CR-F018: Context Menus Lack Keyboard Navigation [MEDIUM]
**Files:** `MemberList.svelte`, `ChannelSidebar.svelte`, `ServerList.svelte`

All context menus have `role="menu"` but no arrow-key navigation (Up/Down, Home/End). Menus never receive focus on open. WAI-ARIA menu pattern is incomplete.

### CR-F019: Drag-and-Drop Has No Keyboard Alternative [MEDIUM]
**Files:** `ServerList.svelte`, `ChannelSidebar.svelte`

Server and channel reordering uses HTML drag-and-drop only. No keyboard alternative (e.g., Ctrl+Up/Down) exists.

### CR-F020: Presence Dots Use Unicode Without Screen Reader Labels [MEDIUM]
**File:** `MemberList.svelte:347`

```svelte
<span class="presence-dot {presence.className}">{presence.dot}</span>
```

Unicode circles are read aloud as "black circle." Need `aria-hidden="true"` with visually-hidden status text.

### CR-F021: Spoiler Reveal is Mouse-Only [MEDIUM]
**File:** `Message.svelte:298-304`

Spoiler toggle uses `onclick` with no keyboard mechanism. `a11y_click_events_have_key_events` warning suppressed.

### CR-F022: Skeleton Loaders Have No ARIA [LOW]
**File:** `MessageList.svelte:558-601`

Skeleton placeholders have no `role="status"` or `aria-label="Loading"`. Screen readers encounter empty divs.

### CR-F023: System Message Icons Lack `aria-hidden` [LOW]
**File:** `MessageList.svelte:619,639`

Unicode arrows/symbols are decorative. Should have `aria-hidden="true"`.

### CR-F024: Hover Card is Keyboard Inaccessible [LOW]
**File:** `MemberList.svelte:382-406`

Hover card only appears on mouse enter. Keyboard-only users who Tab to a member never see the tooltip.

### CR-F025: `role="listbox"` Used Incorrectly for Member List [LOW]
**File:** `MemberList.svelte:332`

`role="listbox"` is for selection widgets. The member list is a navigable list, not a select. Use `role="list"` with `role="listitem"`.

### CR-F026: Poor Contrast on Muted Text [LOW]
**File:** `app.css:30`

`--text-muted: #5c5f66` on `--surface-base: #27282d` yields ~2.7:1 contrast ratio. WCAG AA requires 4.5:1 for normal text.

### CR-F027: No `prefers-color-scheme` Support [LOW]
**File:** `app.css`

No automatic theme switching based on OS preference. Users must manually select a theme.

---

## 4. Architecture & Code Smells

### CR-F028: God Component — chat/+page.svelte (2135 lines) [HIGH]
**File:** `accord-client/src/routes/chat/+page.svelte`

Handles: IRC connection, voice/video, push-to-talk, emoji, editing, channel navigation, keybindings, reconnection, MONITOR, rate limiting, ChanServ registration, welcome modals, profile popouts, search, settings, server settings, and all layout.

**Recommendation:** Extract into modules: `useConnection()`, `useVoice()`, `useKeybindings()`, etc. Break template into named components.

### CR-F029: God Component — UserSettings.svelte (2282 lines) [HIGH]
**File:** `accord-client/src/components/UserSettings.svelte`

Contains all settings tabs inline. Each tab should be its own component.

### CR-F030: Massive Duplication — Voice Connection Logic [MEDIUM]
**File:** `chat/+page.svelte:495-616`

`handleVoiceChannelClick` and `handleDMVoiceCall` duplicate: mic permission request, token fetch, disconnect-previous logic, error display pattern. ~120 lines duplicated.

### CR-F031: Massive Duplication — Login/Register Flows [MEDIUM]
**File:** `login/+page.svelte:46-242`

`handleLogin` and `handleRegister` duplicate: validation, connection setup, CAP/SASL negotiation, post-auth sequence. ~100 lines duplicated.

### CR-F032: Massive Duplication — init/reconnect Flows [MEDIUM]
**File:** `chat/+page.svelte:719-991`

`initConnection` and `handleReconnect` duplicate CAP negotiation, NICK/USER registration, SASL auth. ~40 lines duplicated.

### CR-F033: Duplicated Context Menu Pattern (3 Components) [MEDIUM]
**Files:** `MemberList.svelte`, `ChannelSidebar.svelte`, `ServerList.svelte`

Each has its own context menu state, positioning, overlay handling, and nearly identical CSS. Should be a shared `<ContextMenu>` component.

### CR-F034: Duplicated Caching Infrastructure (2 Files) [MEDIUM]
**Files:** `lib/files/preview.ts`, `lib/api/accountInfo.ts`

Identical `CacheEntry` interface, `evictCache()`, in-flight dedup pattern, three-branch `_doFetch`. Extract a generic `AsyncCache<K, V>` class.

### CR-F035: Dual Member Stores [MEDIUM]
**Files:** `lib/state/channels.svelte.ts`, `lib/state/members.svelte.ts`

Members tracked in both stores simultaneously. IRC handler must update both on every JOIN/PART/QUIT/NICK. Creates consistency risk and doubles memory.

### CR-F036: `hasLocalStorage()` Duplicated 5 Ways [LOW]
**Files:** `channels.svelte.ts:149`, `notifications.svelte.ts:27`, `servers.svelte.ts:25`, `theme.svelte.ts:61` (inline), `appSettings.svelte.ts:50` (inline)

Extract to `$lib/utils/storage.ts`.

### CR-F037: `MODE_PRECEDENCE`/`MODE_ORDER` Duplicated 3x [LOW]
**Files:** `constants.ts:29`, `members.svelte.ts:13`, `handler.ts:197`

Use `MODE_ORDER` from `$lib/constants` everywhere.

### CR-F038: Version-Counter Notify Pattern Duplicated 4x [LOW]
**Files:** `channels.svelte.ts`, `messages.svelte.ts`, `notifications.svelte.ts`, `members.svelte.ts`

Each independently reimplements `let _version = $state(0); function notify() { _version++; }`. Extract a `ReactiveMap` wrapper.

### CR-F039: `baseUrl` Trailing-Slash Stripping Repeated 8x [LOW]
**Files:** `preview.ts`, `account.ts`, `invites.ts`, `upload.ts`, `accountInfo.ts`

```typescript
const baseUrl = filesUrl.replace(/\/+$/, '');
```

Normalize `filesUrl` once at storage time.

### CR-F040: Identical Functions — `shouldShowUnread`/`hasVisibleUnread` [LOW]
**File:** `ChannelSidebar.svelte:128-142`

Two functions with identical logic, character for character. Consolidate to one.

### CR-F041: Identical Functions — `getServerUnread`/`getServerMentions` [LOW]
**File:** `ServerList.svelte:12-41`

Same structure, only inner call differs. Unify into `aggregateAcrossChannels(fn)`.

### CR-F042: Duplicated Channel Rendering in ChannelSidebar [LOW]
**File:** `ChannelSidebar.svelte:333-458`

Channel item template duplicated between categories and "Other" section. Extract to snippet/component.

### CR-F043: DM Buffer Routing Logic Duplicated 4x [LOW]
**File:** `handler.ts:318,369,409,685`

```typescript
const isIncomingDM = rawTarget.toLowerCase() === userState.nick?.toLowerCase();
const bufferTarget = isIncomingDM ? senderNick : rawTarget;
```

Extract `resolveBufferTarget(rawTarget, senderNick)`.

### CR-F044: Self-Kick/Self-Part Channel Removal Duplicated [LOW]
**File:** `handler.ts:450-461,497-507`

Identical code for removing channel and switching to first text channel.

### CR-F045: Duplicated API Client Pattern [LOW]
**Files:** `account.ts`, `accountInfo.ts`, `invites.ts`, `upload.ts`, `preview.ts`

All manually construct `fetch()` with same Authorization header pattern. Extract `apiClient(filesUrl, token)`.

### CR-F046: Empty Handlers in ServerList [LOW]
**File:** `ServerList.svelte:103-119`

`handleDisconnect()` and `handleServerSettings()` are wired to clickable buttons but do nothing except close the context menu. Either disable or remove.

### CR-F047: `renderCodeBlocks()` Likely Dead Code [LOW]
**File:** `format.ts:581`

`renderMessage()` handles code blocks internally. The standalone `renderCodeBlocks()` export appears unused and produces incorrect results if called directly.

### CR-F048: Dead `messageState` Legacy Export [LOW]
**File:** `messages.svelte.ts:434-437`

Labeled "Legacy export" but never imported anywhere.

### CR-F049: `AccordConfig` Interface Defined Inline [LOW]
**File:** `chat/+page.svelte:65-88`

Should be in a shared types file.

### CR-F050: Magic String `'_input_'` for Emoji Picker Mode [LOW]
**File:** `chat/+page.svelte:378`

Should be a discriminated union type or separate boolean.

---

## 5. Performance

### CR-F051: No Virtual Scrolling for Member List [MEDIUM]
**File:** `MemberList.svelte`

All member rows rendered to DOM at once. For large channels (hundreds+ members), this is costly. `MessageList` has virtual scrolling; `MemberList` does not.

### CR-F052: `offsetAtIndex` is O(n) [MEDIUM]
**File:** `MessageList.svelte:252-258`

Linear scan from 0 to `index` for spacer height calculation. Called on every scroll. Use prefix-sum cache for O(1).

### CR-F053: `getMembers()`/`getMembersByRole()` Re-Sort Every Reactive Tick [MEDIUM]
**File:** `members.svelte.ts:144,164`

Sort on every access. For channels with hundreds of members, sorting on every presence update or mode change is wasteful. Cache sorted results.

### CR-F054: Regex Compiled Per Message for Mention Detection [MEDIUM]
**Files:** `handler.ts:359`, `Message.svelte:86`

`new RegExp(...)` created for every incoming message and every rendered message component. Cache the compiled regex.

### CR-F055: `resolveAccountForNick` Iterates All Members [LOW]
**File:** `chat/+page.svelte:622-650`

Three nested iterations over all DMs, all channel members, and all rich members. Called per-profile-popout. Build a lookup map.

### CR-F056: `svelte:window bind:innerWidth` Fires on Every Pixel [LOW]
**File:** `chat/+page.svelte:1655`

Triggers reactive updates on every resize pixel. Use `matchMedia` or debounce since only discrete thresholds matter.

### CR-F057: `getChannelsForNick` is O(C * M) [LOW]
**File:** `channels.svelte.ts:93-102`

Iterates every channel's member map. Re-runs on any channel mutation.

### CR-F058: `searchEmoji()` Lowercases on Every Keystroke [LOW]
**File:** `emoji.ts:274`

Pre-compute lowercase name/keyword indices.

### CR-F059: `escapeHTML()` Uses 5 Chained `.replace()` Calls [LOW]
**File:** `format.ts:41`

Each creates a new string. Single-pass with lookup map would be more efficient for long strings.

### CR-F060: No Context Menu Viewport Boundary Clamping [LOW]
**Files:** `MemberList.svelte:364`, `ChannelSidebar.svelte:480`, `ServerList.svelte`

Right-clicking near screen edges renders menus off-screen. Clamp position to viewport bounds.

---

## 6. Error Handling

### CR-F061: `handleBatchedMessage` Drops Non-PRIVMSG Commands [MEDIUM]
**File:** `handler.ts:678`

Only PRIVMSG is processed in chathistory batches. REDACT and TAGMSG (reactions) are silently discarded.

### CR-F062: `rawTarget` Not Null-Checked Before `.toLowerCase()` [MEDIUM]
**File:** `handler.ts:310,365,402,679`

If `parsed.params[0]` is undefined, `.toLowerCase()` throws. Add guard: `if (!rawTarget) return;`

### CR-F063: InviteStore Write Failures Silently Swallowed [MEDIUM]
**File:** `accord-files/src/routes/invite.ts:44-49`

`.catch()` logs but swallows. Caller (route handler) told save succeeded when it didn't. In-memory and on-disk state diverge.

### CR-F064: Ergo API 5xx Misreported as "Incorrect Password" [MEDIUM]
**File:** `accord-files/src/routes/account.ts:62-64`

```typescript
if (!verifyRes.ok) {
    return c.json({ error: "Current password is incorrect" }, 403);
}
```

Should distinguish Ergo server errors from auth failures. Return 502 for upstream errors.

### CR-F065: No Request Timeouts on Any Client API Calls [MEDIUM]
**Files:** `account.ts`, `accountInfo.ts`, `invites.ts`, `upload.ts`, `preview.ts`

No `AbortController` or timeout mechanism. Slow/unresponsive `accord-files` hangs UI indefinitely.

### CR-F066: `connection.ts` `emit()` Doesn't Protect Handler Exceptions [MEDIUM]
**File:** `connection.ts:155`

If any event handler throws, remaining handlers for same event are skipped. Wrap each in try/catch.

### CR-F067: `appSettings.svelte.ts` Lacks SSR Guards for localStorage [LOW]
**File:** `appSettings.svelte.ts:50,74`

Direct `localStorage` access without `typeof` check. Will throw in SSR context.

### CR-F068: `fetchAccordConfig` Silently Swallows All Errors [LOW]
**File:** `chat/+page.svelte:700-713`

Returns `null` on any error with no logging or user feedback. Malformed `accord.json` breaks config silently.

### CR-F069: No Validation on `accord.json` Data Shape [LOW]
**File:** `chat/+page.svelte:776-819`

Config is cast with `as AccordConfig` and used without schema validation.

### CR-F070: `initConnection` Has No Overall Timeout [LOW]
**File:** `chat/+page.svelte:719-884`

If IRC server hangs during CAP/SASL, UI shows "Connecting..." indefinitely.

### CR-F071: `hoverTimeout` Never Cleaned Up on Destroy [LOW]
**File:** `MemberList.svelte:43`

No `onDestroy` hook to clear pending `setTimeout`. Callback fires on destroyed component.

### CR-F072: No File Size or Type Validation Before Upload [LOW]
**Files:** `upload.ts:24`, `MessageInput.svelte`

No client-side file size limit or MIME type check. Users can attempt multi-GB uploads.

### CR-F073: NickServ Response Parsing Is Fragile [LOW]
**File:** `login/+page.svelte:306-326`

Depends on English error message substrings. Different IRC servers or locales produce different messages.

---

## 7. CSS & Styling

### CR-F074: Hardcoded `#fff` Throughout [MEDIUM]

Should use `var(--text-inverse)`. Found in:
- `ServerSettings.svelte:1043,1095,1154,1325`
- `Message.svelte:1119`
- `ChannelSidebar.svelte:1057`
- `ServerList.svelte:291,351,366,394,452`
- `MessageList.svelte:856`
- `chat/+page.svelte:1947,2125`
- `login/+page.svelte:542`

### CR-F075: Non-Existent `--status-error` Token [MEDIUM]
**File:** `ServerSettings.svelte:817,1042,1148,1153`

`var(--status-error, #e05050)` references a token that doesn't exist in `app.css`. The design system uses `--danger`. Always falls back to hardcoded `#e05050`.

### CR-F076: Hardcoded `rgba()` Shadow/Overlay Values Everywhere [MEDIUM]

All files use raw `rgba(0, 0, 0, ...)` for shadows and overlays. Need design tokens: `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--overlay-backdrop`.

Found in: `Message.svelte`, `MessageList.svelte`, `MemberList.svelte`, `ChannelSidebar.svelte`, `ServerList.svelte`, `ServerSettings.svelte`, `WelcomeModal.svelte`, `chat/+page.svelte`, `login/+page.svelte`.

### CR-F077: Hardcoded Syntax Highlight Colors Not Theme-Aware [MEDIUM]
**File:** `Message.svelte:972-992`

One Dark palette colors (`#c678dd`, `#98c379`, etc.) hardcoded. Will look incorrect on light themes. Should be CSS custom properties.

### CR-F078: Theme Token Duplication in app.css [LOW]
**File:** `app.css:13-220`

Compact and AMOLED themes repeat 50+ lines of identical values from dark. Use cascade: define base on `:root[data-theme="dark"]` and only override differences.

### CR-F079: No Default Theme Fallback [LOW]
**File:** `app.css`

All tokens scoped under `[data-theme="..."]`. If attribute is missing, entire UI has no colors.

### CR-F080: No Z-Index Scale [LOW]
**File:** `chat/+page.svelte`

Ad-hoc values: 1, 150, 200, 1000, 1100. No `--z-sidebar`, `--z-overlay`, `--z-modal` tokens.

### CR-F081: Magic Number `72px` for Message Gutter [LOW]
**Files:** `Message.svelte:650,672`, `MessageList.svelte:695,783,801`

Should be a CSS custom property `--message-gutter`.

### CR-F082: Hardcoded Transition Durations [LOW]

Many components use raw `80ms`, `100ms`, `150ms`, `0.1s` instead of duration tokens (`--duration-channel`, `--duration-message`).

### CR-F083: `--msg-*` Spacing Tokens Only in Compact Theme [LOW]
**File:** `app.css:213-220`

Variables like `--msg-padding-y`, `--msg-font-size` defined only in compact. Other themes use hardcoded defaults.

### CR-F084: Dead CSS Rule `.toolbar-btn-danger` [LOW]
**File:** `Message.svelte:771-778`

Defined in CSS but never used in template.

### CR-F085: No `:focus-visible` Styles on Buttons [LOW]

Multiple components define `:hover` but no `:focus-visible`. Keyboard users get no focus indication. Affected: `MessageInput.svelte` (file/emoji buttons), `chat/+page.svelte` (delete dialog buttons), `login/+page.svelte` (form inputs/buttons).

---

## 8. Type Safety

### CR-F086: Unsafe `as` Casts on `res.json()` Throughout [MEDIUM]
**Files:** `preview.ts:107`, `upload.ts:53`, `invites.ts:37,71`, `accountInfo.ts:94`

All API responses cast with `as` without runtime validation. Server API changes produce silently incorrect objects.

### CR-F087: Unsafe `as` Casts on localStorage JSON [MEDIUM]
**Files:** `messages.svelte.ts:61`, `notifications.svelte.ts:37`, `keybindings.ts:45`

`JSON.parse(raw) as Record<...>` trusts localStorage data without validation. Corrupted data causes runtime errors.

### CR-F088: `any` Types in Event System [LOW]
**File:** `connection.ts:24,136,155`

All event handler types use `any`. Should use discriminated event map for type safety.

### CR-F089: `ZoomLevel` Setter Has No Runtime Validation [LOW]
**File:** `appSettings.svelte.ts:83`

Setter accepts any number at runtime despite TypeScript type. `load()` validates but setter doesn't.

---

## 9. Test Coverage Gaps

### Missing Component Tests
No Svelte component tests exist. All tests are unit tests for:
- State management stores
- IRC protocol layer (handler, format, connection, cap, sasl, parser, commands)
- API client functions
- Utility libraries

No integration or E2E tests verify:
- Component rendering and user interactions
- Full connection lifecycle
- Theme switching behavior
- Keyboard navigation
- Dialog focus management

### Specific Missing Tests (from CR-012 through CR-014)
These were addressed in task_37c3cc11:
- MARKREAD handler, DM routing, self-PART (handler.test.ts)
- replaceOptimisticMessage, appendMessages (messages.svelte.test.ts)
- getFrequentEmoji, recordEmojiUse (emoji.test.ts)

### Remaining Coverage Gaps
- **ServerSettings.svelte:** No tests for invite CRUD, role management, appearance settings
- **WelcomeModal.svelte:** No tests
- **ResizeHandle.svelte:** No tests
- **SlashCommandMenu.svelte:** No tests
- **QuickSwitcher.svelte:** No tests
- **Login/Register flow:** No tests for the dual flow, NickServ registration parsing
- **Voice/Video connection:** No tests for LiveKit integration
- **Theme server override application:** State tests exist, but no tests for CSS variable injection

---

## 10. Previously Deferred Items Status

| CR ID | Issue | Status |
|-------|-------|--------|
| CR-012 | Handler test coverage | **Resolved** (task_37c3cc11) |
| CR-013 | Message state mutation tests | **Resolved** (task_37c3cc11) |
| CR-014 | Emoji utility tests | **Resolved** (task_37c3cc11) |
| CR-018 | Rate limiting on endpoints | **Resolved** (rateLimit.ts middleware added) |
| CR-023 | InviteStore race conditions | **Mitigated** (single-process safe; multi-process risk remains) |
| CR-024 | Invite GET increments use count | **Resolved** (separate redeem endpoint) |
| CR-032 | getMessage O(n) scan | **Still present** (messages.svelte.ts:170) |
| CR-035 | Keybinding conflict detection | **Resolved** (keybindings.test.ts) |
| CR-040 | Template duplication in Message.svelte | **Still present** (reply/nick blocks duplicated between cozy/compact) |
| CR-041 | File size limit before upload | **Still missing** client-side (server enforces) |
| CR-042 | Search runs synchronously | **Resolved** (debounced in SearchPanel) |
| CR-046 | SSRF bypass tests | **Resolved** (task_75159c48) |
| CR-047 | Invite authorization tests | **Resolved** (task_75159c48) |
| CR-048 | Dangerous file upload tests | **Resolved** (task_75159c48) |
| CR-049 | Duplicated ROLE_MAP | **Resolved** (centralized in constants.ts, task_7527dfc2) |
| CR-050 | Inconsistent event prop naming | **Partially resolved** (some callbacks still use inconsistent names) |
| CR-051 | Accessibility gaps | **Mostly unresolved** (see Section 3 above) |
| CR-053 | Code duplication | **Partially resolved** (ROLE_MAP fixed, but many new duplications introduced) |
| CR-057-060 | Performance optimizations | **Partially resolved** (search debounced, scroll throttled, emoji virtualized) |

---

## Issue Count Summary

| Severity | Count |
|----------|-------|
| Critical/High | 3 (security: SSRF bypass, rate limit bypass, rate limit memory) |
| High (accessibility) | 5 (focus traps, focus management, ARIA tabs, focus rings, landmarks) |
| High (architecture) | 2 (god components) |
| Medium | 30 |
| Low | 45 |
| **Total** | **85** |

### Top 10 Actionable Items (Effort vs Impact)

1. **Extract shared `<ContextMenu>` component** — Eliminates 3x duplication, fixes keyboard nav in one place
2. **Add focus trapping utility** — Fixes all modal accessibility issues at once
3. **Create CSS design tokens for shadows, overlays, z-index** — Fixes ~20 hardcoded value issues
4. **Replace `#fff` with `var(--text-inverse)`** — 15-minute grep-and-replace
5. **Fix `--status-error` to `--danger`** — 4 instances in ServerSettings
6. **Add syntax highlight CSS custom properties** — Makes code blocks theme-aware
7. **Extract `useConnection()` and `useVoice()` from chat/+page.svelte** — Biggest architectural win
8. **Add `encodeURIComponent` on invite token path** — One-line security fix
9. **Add viewport boundary clamping to context menus** — Improves UX, shared fix
10. **Cache mention detection regex** — Simple perf win across all messages
