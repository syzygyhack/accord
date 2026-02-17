# Final Code Review

**Date:** 2026-02-17
**Scope:** Full codebase review of accord-client and accord-files
**Focus:** Code smells, UI/UX patterns, test coverage, error handling, inconsistent patterns, security, performance, stale references, documentation accuracy, test health

---

## Verification Results

| Suite | Command | Result |
|-------|---------|--------|
| Backend tests | `bun test` | **155 pass**, 0 fail, 0 skip |
| Frontend tests | `npx vitest run` | **744 pass**, 0 fail, 0 skip (31 test files) |
| Svelte check | `npx svelte-check` | **0 errors, 0 warnings** |
| Stale `virc` references | `rg -i virc` (all files) | **0 matches** in source/config/docs |
| Total tests | | **899** |

The only remaining "virc" reference is the git remote URL (`https://github.com/syzygyhack/virc`), which reflects the GitHub repository name and is expected.

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
9. [Inconsistent Patterns](#9-inconsistent-patterns)
10. [Test Coverage Gaps](#10-test-coverage-gaps)
11. [Documentation Accuracy](#11-documentation-accuracy)
12. [Previously Deferred Items Status](#12-previously-deferred-items-status)

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

When `TRUST_PROXY` is enabled without a trusted proxy, the entire `X-Forwarded-For` header is attacker-controlled. An attacker can set any IP to bypass rate limiting.

**Note:** The middleware does check `env.TRUST_PROXY` before reading the header. When disabled, socket address is used. The risk exists only when misconfigured.

### CR-F003: Unbounded Rate Limit Store Growth [HIGH]
**File:** `accord-files/src/middleware/rateLimit.ts:59-63`

**Update:** The store now has a 50K entry cap with periodic cleanup on incoming requests. This significantly mitigates but doesn't eliminate the risk -- an attacker rotating IPs could still fill the store to the cap, causing legitimate IPs to be rejected.

---

## 2. Security

### CR-F004: `linkify()` / `highlightMentions()` XSS-Fragile Contract [MEDIUM]
**Files:** `accord-client/src/lib/irc/format.ts:282,324`

Both functions are exported and documented as requiring pre-escaped input. The rendering pipeline (`renderIRC` -> `linkify` -> `highlightMentions` -> `renderCustomEmoji`) does call `escapeHTML()` at the entry point (`renderIRC` line 233). Warning comments exist at lines 319-321. The security invariant is maintained but depends entirely on callers always using `renderMessage()` as the entry point.

**Risk:** Any bypass of the pipeline on user-controlled text would create XSS.

### CR-F005: Invite Token Now URL-Encoded [RESOLVED]
**File:** `accord-client/src/lib/api/invites.ts:79`

Previous review noted missing `encodeURIComponent`. Current code uses `encodeURIComponent(inviteToken)`.

### CR-F006: OG Tag Values Returned Unsanitized [MEDIUM]
**File:** `accord-files/src/routes/preview.ts:230-236`

Parsed OG meta tags from external pages are returned as-is. If client renders `og:title` as HTML, this is a stored XSS vector.

### CR-F007: Missing IPv6 All-Zeros Check in SSRF Filter [MEDIUM]
**File:** `accord-files/src/routes/preview.ts:116-143`

`isPrivateHost()` checks for `::1`, `fe80:`, `fc00:`, `fd`, but not `::` (all-zeros, equivalent to `0.0.0.0`), `100::/64`, or `2001:db8::/32`.

### CR-F008: CSS Injection via Role Colors [LOW]
**Files:** `Message.svelte`, `MemberList.svelte`

Nick colors from `getRoleColor()` are injected directly into `style` attributes. If a compromised server config returns a string like `red; background-image: url(evil)`, this is CSS injection.

### CR-F009: Password Minimum Now 8 Characters [RESOLVED]
**File:** `accord-files/src/routes/account.ts:37-39`

```typescript
if (newPassword.length < 8) {
    return c.json({ error: "New password must be at least 8 characters" }, 400);
}
```

### CR-F010: All Invites Visible to Any Authenticated User [LOW]
**File:** `accord-files/src/routes/invite.ts`

`GET /api/invite` returns all invites for any authenticated user.

### CR-F011: No Upload Quota Per User [LOW]
**File:** `accord-files/src/routes/files.ts`

No per-user upload limit beyond the global rate limiter.

### CR-F012: No Global Request Body Size Limit [LOW]
**File:** `accord-files/src/index.ts`

No middleware limiting request body size.

### CR-F-NEW-01: Credentials Stored in localStorage in Web Builds [MEDIUM]
**File:** `accord-client/src/lib/api/auth.ts:128`

In non-Tauri (web) builds, the raw password is stored in localStorage as JSON. Accessible to any JavaScript on the same origin via XSS.

### CR-F-NEW-02: No TLS Enforcement for WebSocket SASL [LOW]
**File:** `accord-client/src/lib/irc/sasl.ts:49-53`

SASL PLAIN sends `\0account\0password` as base64. Safe only over `wss://`. No check enforces TLS for the WebSocket URL.

### CR-F-NEW-03: No Validation on Custom Emoji URLs from Config [LOW]
**File:** `accord-client/src/lib/connection/lifecycle.ts:122-134`

Custom emoji URLs from `accord.json` are accepted without URL validation. A malicious server config could inject `javascript:` or `data:` URIs.

### CR-F-NEW-04: Login Page Does Not Validate WebSocket URL Format [LOW]
**File:** `accord-client/src/routes/login/+page.svelte:47-50`

Only checks if `serverUrl.trim()` is truthy. No validation that it is a valid `ws://` or `wss://` URL.

---

## 3. Accessibility

### CR-F013: No Focus Traps in Modal Dialogs [HIGH]
**Files:** `ServerSettings.svelte`, `WelcomeModal.svelte`, `UserSettings.svelte`, `EmojiPicker.svelte`, `ChannelSidebar.svelte`, `AuthExpiredModal.svelte`, `DeleteConfirmDialog.svelte`

All modals use `aria-modal="true"` but implement no focus trapping. Focus can Tab out of dialogs into background content.

### CR-F014: No Focus Management on Dialog Open [HIGH]
**Files:** All modal components listed above

Dialogs never receive programmatic focus when opened.

### CR-F015: Missing ARIA Tab Pattern [HIGH]
**Files:** `ServerSettings.svelte:240-262`, `UserSettings.svelte`

Tab navigation uses visual `.active` class but no ARIA attributes (`role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`).

### CR-F016: Textarea Missing Focus Ring [HIGH]
**File:** `MessageInput.svelte:1012`

`textarea { outline: none; }` with no `:focus-visible` replacement.

### CR-F017: No Landmark Roles in Main Layout [HIGH]
**File:** `chat/+page.svelte`

No `<main>`, `<nav>`, `<aside>`, or `<header>` landmarks.

### CR-F018: Context Menus Lack Keyboard Navigation [MEDIUM]
**Files:** `MemberList.svelte`, `ChannelSidebar.svelte`, `ServerList.svelte`

All context menus have `role="menu"` but no arrow-key navigation.

### CR-F019: Drag-and-Drop Has No Keyboard Alternative [MEDIUM]
**Files:** `ServerList.svelte`, `ChannelSidebar.svelte`

### CR-F020: Presence Dots Use Unicode Without Screen Reader Labels [MEDIUM]
**File:** `MemberList.svelte:347`

### CR-F021: Spoiler Reveal is Mouse-Only [MEDIUM]
**File:** `Message.svelte`

### CR-F022: Skeleton Loaders Have No ARIA [LOW]
**File:** `MessageList.svelte`

### CR-F023: System Message Icons Lack `aria-hidden` [LOW]
**File:** `MessageList.svelte`

### CR-F024: Hover Card is Keyboard Inaccessible [LOW]
**File:** `MemberList.svelte`

### CR-F025: `role="listbox"` Used Incorrectly for Member List [LOW]
**File:** `MemberList.svelte:332`

### CR-F026: Poor Contrast on Muted Text [LOW]
**File:** `app.css:30` -- `--text-muted: #5c5f66` yields ~2.7:1 contrast ratio (WCAG AA requires 4.5:1).

### CR-F027: No `prefers-color-scheme` Support [LOW]
**File:** `app.css`

### CR-F-NEW-05: ResizeHandle Has ARIA but No Keyboard Handler [LOW]
**File:** `accord-client/src/components/ResizeHandle.svelte`

Has `role="separator"`, `tabindex="0"`, `aria-valuenow/min/max` but no `onkeydown` handler. Keyboard users can focus but cannot resize.

### CR-F-NEW-06: 41 Suppressed `svelte-ignore a11y_*` Warnings [LOW]
**Files:** 12 component files

`ChannelSidebar.svelte` (11), `ServerList.svelte` (6), `Message.svelte` (5), `VoiceOverlay.svelte` (4), `UserSettings.svelte` (3), and 7 other files.

---

## 4. Architecture & Code Smells

### CR-F028: Large Components [HIGH]

| Component | Lines |
|-----------|-------|
| `UserSettings.svelte` | 2,270 |
| `Message.svelte` | 1,403 |
| `ServerSettings.svelte` | 1,388 |
| `MessageInput.svelte` | 1,246 |
| `ChannelSidebar.svelte` | 1,083 |
| `MessageList.svelte` | 888 |
| `chat/+page.svelte` | 809 |

### CR-F029: Dual Member Stores [MEDIUM]
**Files:** `lib/state/channels.svelte.ts`, `lib/state/members.svelte.ts`

Members tracked in both stores simultaneously. IRC handler must update both on every JOIN/PART/QUIT/NICK.

### CR-F030: Version-Counter Notify Pattern Duplicated 6x [MEDIUM]
**Files:** `channels.svelte.ts`, `members.svelte.ts`, `messages.svelte.ts`, `notifications.svelte.ts`, `presence.svelte.ts`, `typing.svelte.ts`

Each independently reimplements `let _version = $state(0); function notify() { _version++; }` and the `{ get X() { void _version; return _map; } }` accessor pattern.

### CR-F031: Duplicated Caching Infrastructure [MEDIUM]
**Files:** `lib/files/preview.ts`, `lib/api/accountInfo.ts`

Identical `CacheEntry` interface, `evictCache()`, in-flight dedup pattern.

### CR-F032: Duplicated Login/Register Flows [MEDIUM]
**File:** `login/+page.svelte:46-242`

`handleLogin` and `handleRegister` duplicate ~100 lines of validation, connection setup, CAP/SASL negotiation.

### CR-F033: Duplicated init/reconnect Flows [MEDIUM]
**File:** `accord-client/src/lib/connection/lifecycle.ts:216-305`

`initConnection` and `handleReconnect` duplicate NICK/USER registration, SASL auth, JWT fetch+refresh blocks.

### CR-F034: Duplicated Context Menu Pattern (3 Components) [MEDIUM]
**Files:** `MemberList.svelte`, `ChannelSidebar.svelte`, `ServerList.svelte`

### CR-F035: Duplicated `isOp` Computation (5 instances) [LOW]
**Files:** `ChannelSidebar.svelte`, `HeaderBar.svelte`, `MemberList.svelte`, `ServerSettings.svelte`, `chat/+page.svelte`

Same `['~', '&', '@'].includes(member.highestMode)` pattern repeated.

### CR-F036: Duplicated Voice Control SVGs [LOW]
**Files:** `VoicePanel.svelte`, `VoiceOverlay.svelte`

Identical SVG paths for mute, deafen, video, screen share, disconnect buttons, differing only in `width`/`height`.

### CR-F037: Duplicated Voice Toggle Shortcut Boilerplate [LOW]
**File:** `accord-client/src/lib/shortcuts.ts:169-222`

Four voice shortcut handlers share identical boilerplate; only the toggle function differs.

### CR-F038: Duplicated Tag Check in Scroll Shortcuts [LOW]
**File:** `accord-client/src/lib/shortcuts.ts:270-301`

Four keybinding handlers perform the same `tagName` check verbatim.

### CR-F039: Duplicated Media Extension Definitions [LOW]
**Files:** `lib/media.ts:16-18`, `lib/files/preview.ts:144`

Same media types defined in different forms.

### CR-F040: `channels.svelte.ts` Mixes IRC and UI Concerns [LOW]
**File:** `accord-client/src/lib/state/channels.svelte.ts`

Contains both IRC-level channel state (members, topics) and UI-level state (active channel, categories, DM conversations).

### CR-F041: `renderCodeBlocks()` Likely Dead Code [LOW]
**File:** `format.ts:586`

`renderMessage()` handles code blocks internally. This standalone export appears redundant.

### CR-F042: Magic String `'_input_'` for Emoji Picker Mode [LOW]
**File:** `accord-client/src/lib/messageActions.ts:94,104`

Used as sentinel to distinguish emoji picker modes. Could collide with a msgid.

### CR-F043: Non-functional UI Elements [LOW]
- `ServerList.svelte:227-234`: "Add Server" button has no `onclick` handler
- `ServerList.svelte:102-107`: "Disconnect" action only closes context menu
- `UserPanel.svelte:93`: Status dot is always green (hardcoded `--status-online`)

### CR-F044: `hasLocalStorage()` Utility Under-Adopted [LOW]
**File:** `accord-client/src/lib/utils/storage.ts`

Exists but most files inline the same check or skip it entirely.

---

## 5. Performance

### CR-F051: No Virtual Scrolling for Member List [MEDIUM]
**File:** `MemberList.svelte`

### CR-F052: `offsetAtIndex` is O(n) [MEDIUM]
**File:** `MessageList.svelte:252-258`

### CR-F053: `getMembers()`/`getMembersByRole()` Re-Sort Every Reactive Tick [MEDIUM]
**File:** `members.svelte.ts`

### CR-F054: Regex Compiled Per Message for Mention Detection [MEDIUM]
**Files:** `handler.ts`, `Message.svelte`

### CR-F055: `resolveAccountForNick` Triple-Nested Iteration [LOW]
**File:** `accord-client/src/lib/voice/manager.ts:30-57`

Iterates all DM conversations, then all channels' members. O(total_members_across_all_channels).

### CR-F056: `searchEmoji()` Linear Scan on Every Keystroke [LOW]
**File:** `emoji.ts:274-282`

Iterates all emoji, calls `toLowerCase()` on every name/keyword per search.

### CR-F057: `getFrequentEmoji` Parses localStorage on Every Call [LOW]
**File:** `emoji.ts:295-303`

### CR-F058: `renderIRC` / `highlightCode` O(n^2) String Concatenation [LOW]
**Files:** `format.ts:61-242`, `format.ts:464-571`

Character-by-character string concatenation. Using array + `join()` would be more efficient.

### CR-F059: Repeated DM Sorting on Every Update [LOW]
**File:** `channels.svelte.ts:306`

`addDMConversation()` calls `sortDMConversations()` on every invocation.

### CR-F060: `getMessage()` Not Reactive [LOW]
**File:** `messages.svelte.ts:170-173`

Does not read `_version`, so it won't trigger re-evaluation in `$derived` contexts. Compare with `getMessages()` at line 182.

---

## 6. Error Handling

### CR-F061: `handleBatchedMessage` Drops Non-PRIVMSG Commands [MEDIUM]
**File:** `handler.ts`

Only PRIVMSG is processed in chathistory batches. REDACT and TAGMSG are silently discarded.

### CR-F062: `rawTarget` Not Null-Checked Before `.toLowerCase()` [MEDIUM]
**File:** `handler.ts:310,365,402,679`

### CR-F063: InviteStore Write Failures Silently Swallowed [MEDIUM]
**File:** `accord-files/src/routes/invite.ts`

### CR-F064: Ergo API 5xx Handled Correctly Now [RESOLVED]
**File:** `accord-files/src/routes/account.ts:52-54`

```typescript
if (verifyRes.status >= 500) {
    return c.json({ error: "Account service error" }, 502);
}
```

The code now checks for 5xx before the generic `!ok` check.

### CR-F065: No Request Timeouts on Client API Calls [MEDIUM]
**Files:** `account.ts`, `accountInfo.ts`, `invites.ts`, `upload.ts`, `preview.ts`

No `AbortController` or timeout mechanism.

### CR-F066: `connection.ts` `emit()` Doesn't Protect Handler Exceptions [MEDIUM]
**File:** `connection.ts:155`

### CR-F067: Missing SSR Guards for localStorage [LOW]
**Files:** `audioSettings.svelte.ts:37,57`, `messages.svelte.ts:59,79`, `theme.svelte.ts:78`

Direct `localStorage` access without `typeof` check. Some files use `hasLocalStorage()`, some inline the check, some skip it entirely.

### CR-F068: `navigator.clipboard.writeText` Errors Silently Swallowed [LOW]
**Files:** `messageActions.ts:238,248`, `ServerList.svelte:95-98`

`.catch(() => {})` gives users no feedback when copy fails.

### CR-F069: No Error Handling on `setMicrophoneEnabled` During Connect [LOW]
**File:** `accord-client/src/lib/voice/room.ts:103`

Permission denial can throw, but it's not wrapped in try/catch. Contrast with `toggleVideo` which has error handling.

### CR-F070: PTT Shortcuts Don't Await `setMicrophoneEnabled` [LOW]
**File:** `accord-client/src/lib/shortcuts.ts:325,343`

Promise returned by `setMicrophoneEnabled` is discarded.

### CR-F071: No Validation on audioSettings Setters [LOW]
**File:** `audioSettings.svelte.ts:75,78`

`videoQuality` setter bypasses `VALID_QUALITIES` validation. `outputVolume` accepts any number (NaN, Infinity, negatives).

---

## 7. CSS & Styling

### CR-F074: Hardcoded `#fff` Throughout [MEDIUM]
Should use `var(--text-inverse)`. Found in 10+ components.

### CR-F075: Non-Existent `--status-error` Token [MEDIUM]
**File:** `ServerSettings.svelte` -- references `var(--status-error, #e05050)` but design system uses `--danger`.

### CR-F076: Hardcoded `rgba()` Shadow/Overlay Values [MEDIUM]
All files use raw `rgba(0, 0, 0, ...)` for shadows. Need design tokens.

### CR-F077: Hardcoded Syntax Highlight Colors [MEDIUM]
**File:** `Message.svelte` -- One Dark palette colors hardcoded. Not theme-aware.

### CR-F078: Theme Token Duplication [LOW]
Compact and AMOLED themes repeat 50+ identical lines from dark.

### CR-F079: No Default Theme Fallback [LOW]
All tokens scoped under `[data-theme="..."]`.

### CR-F080: No Z-Index Scale [LOW]
Ad-hoc values: 1, 150, 200, 1000, 1100.

### CR-F081-085: Minor CSS Issues [LOW]
Magic `72px` gutter, hardcoded transition durations, compact-only `--msg-*` tokens, dead `.toolbar-btn-danger` rule, missing `:focus-visible` styles.

---

## 8. Type Safety

### CR-F086: Unsafe `as` Casts on `res.json()` [MEDIUM]
**Files:** `preview.ts`, `upload.ts`, `invites.ts`, `accountInfo.ts`

### CR-F087: Unsafe `as` Casts on localStorage JSON [MEDIUM]
**Files:** `messages.svelte.ts`, `notifications.svelte.ts`, `keybindings.ts`, `audioSettings.svelte.ts:40`

### CR-F088: `any` Types in Event System [LOW]
**File:** `connection.ts`

### CR-F089: `null as unknown as Room` Type Hack [LOW]
**File:** `accord-client/src/lib/voice/manager.ts:118,166`

`VoiceResult` type claims `room: Room` on success but value is actually null on toggle-off.

---

## 9. Inconsistent Patterns

### CR-F-INC-01: Inconsistent Error Return Patterns Across API Modules [MEDIUM]

| Module | Pattern |
|--------|---------|
| `account.ts` | Returns `{ success: boolean; error?: string }` |
| `invites.ts` | Throws on failure (except `listInvites` returns `[]`) |
| `upload.ts` | Throws on failure |
| `accountInfo.ts` | Returns `null` on failure |

### CR-F-INC-02: Inconsistent Channel Prefix Checks [MEDIUM]
- `channelMonitor.ts:41` checks `startsWith('#') || startsWith('&')`
- `handler.ts:593` checks only `startsWith('#')` (misses `&` channels)
- `voice/manager.ts:173` checks only `startsWith('#')`
- `isDMTarget()` helper exists but is inconsistently used

### CR-F-INC-03: Inconsistent localStorage SSR Guard Strategy [LOW]

| Approach | Files |
|----------|-------|
| Imported `hasLocalStorage()` utility | `channels.svelte.ts`, `notifications.svelte.ts`, `servers.svelte.ts` |
| Inline `typeof localStorage === 'undefined'` | `appSettings.svelte.ts`, `theme.svelte.ts`, `user.svelte.ts` |
| No guard at all | `audioSettings.svelte.ts`, `messages.svelte.ts` |

### CR-F-INC-04: Inconsistent State Architecture [LOW]
Some state files use `$state({...})` reactive proxy objects, others use version-counter + non-reactive Map pattern. No single consistent approach.

### CR-F-INC-05: Missing Reset Functions [LOW]
Most state modules export `reset*()` functions. Exceptions: `voice.svelte.ts`, `audioSettings.svelte.ts`, `connection.svelte.ts`.

### CR-F-INC-06: `ensureChannel` Returns Different Types Across Modules [LOW]
- `channels.svelte.ts`: Returns `ChannelInfo`
- `members.svelte.ts`: Returns `Map<string, Member>`
- `messages.svelte.ts`: Returns `void`
- `notifications.svelte.ts`: Returns `ChannelNotification`

### CR-F-INC-07: Inconsistent Persist-on-Reset Behavior [LOW]
Some `reset*()` functions call `persist()` (appSettings, messages), others don't (servers, channels, notifications, theme).

### CR-F-INC-08: Inconsistent `void` vs `Promise<void>` in Voice [LOW]
Voice toggle functions are `async` but callers in `shortcuts.ts` don't `await` them, discarding the Promise.

---

## 10. Test Coverage Gaps

### Test Health Summary
- **0 skipped tests** in either suite
- **0 `.only`/`.todo`/`xit`/`xdescribe`** found
- All 899 tests run and pass

### Backend Coverage

| Source File | Test File | Status |
|-------------|-----------|--------|
| `routes/auth.ts` | `auth.test.ts` (13) | Covered |
| `routes/account.ts` | `account.test.ts` (10) | Covered |
| `routes/accountInfo.ts` | `accountInfo.test.ts` (8) | Covered |
| `routes/config.ts` | `config.test.ts` (10) | Covered |
| `routes/files.ts` | `files.test.ts` (15) | Covered |
| `routes/invite.ts` | `invite.test.ts` (17) | Covered |
| `routes/livekit.ts` | `livekit.test.ts` (6) | Covered |
| `routes/preview.ts` | `preview.test.ts` (17) | Covered |
| `middleware/auth.ts` | `middleware.test.ts` (7) | Covered |
| `middleware/rateLimit.ts` | `rateLimit.test.ts` (5) | Covered |
| **`ergoClient.ts`** | -- | **No test** |
| **`env.ts`** | -- | **No test** |
| `constants.ts` | -- | Trivial (3 constants) |
| `index.ts` | -- | App wiring (integration territory) |

### Frontend Coverage -- Untested Modules (Priority Order)

| Module | Lines | Risk | Priority |
|--------|-------|------|----------|
| `connection/lifecycle.ts` | 360 | Connection init + reconnect | **HIGH** |
| `messageActions.ts` | 337 | Core user interaction handlers | **HIGH** |
| `shortcuts.ts` | 367 | All keyboard shortcuts + PTT | **HIGH** |
| `voice/room.ts` | 387 | LiveKit room management | MEDIUM |
| `voice/manager.ts` | 220 | Voice call logic | MEDIUM |
| `channelMonitor.ts` | 78 | MONITOR nick tracking | MEDIUM |
| `navigation/channelNav.ts` | 76 | Pure navigation functions | MEDIUM |
| `utils/a11y.ts` | 152 | Focus trapping | MEDIUM |
| `channelEffects.svelte.ts` | 94 | Svelte $effect (hard to test) | LOW |
| `state/audioSettings.svelte.ts` | 89 | Settings store | LOW |
| `state/presence.svelte.ts` | 51 | Simple Set wrapper | LOW |
| `constants.ts` | 47 | Data definitions | LOW |

### No Component Tests
All tests are unit tests for state, IRC protocol, API clients, and utilities. No integration or E2E tests verify component rendering, user interactions, full connection lifecycle, or keyboard navigation.

---

## 11. Documentation Accuracy

### README.md Inaccuracies

| Claim | Actual | Fix Needed |
|-------|--------|------------|
| 26 Svelte components | 28 components | Yes |
| 119 commits | 130 commits | Yes |
| 12 slash commands | 13 (includes `mode`) | Yes |
| ~25,250 source lines | ~25,550 | Minor |

Project structure tree is incomplete -- missing ~10 modules added during post-Cardinal work.

### TODO.md Stale Items
The following items are listed as outstanding but have already been completed:
- LICENSE file creation (exists at repo root)
- CHANGELOG.md creation (exists with proper content)
- Version bump to 0.1.0 (already at 0.1.0 in all 4 locations)
- CI pipeline creation (.github/workflows/ci.yml exists)
- `.dockerignore` creation (exists in accord-files)
- Hardcoded OAuth2 secret (changed to `"CHANGE-ME"`)

### TODO.md / README.md Contradictions
- TODO Known Deferrals says custom emoji "rendering not wired" but README claims it's implemented
- TODO Known Deferrals says "Dark only" for themes but README lists 4 themes (and theme store has 57 tests)

### PLAN.md Architectural Deviations (Expected)
- Route structure: PLAN uses nested `/[server]/[channel]/`, actual uses flat `/chat/`
- Component names: PLAN has `UserList.svelte`, actual is `MemberList.svelte`
- Storage: PLAN mentions MinIO/R2, actual uses local filesystem

### FRONTEND.md Incomplete
Lists 8 stores but actual has 15. Missing: `appSettings`, `audioSettings`, `presence`, `rawIrcLog`, `serverConfig`, `servers`, and others.

---

## 12. Previously Deferred Items Status

| CR ID | Issue | Status |
|-------|-------|--------|
| CR-012 | Handler test coverage | **Resolved** |
| CR-013 | Message state mutation tests | **Resolved** |
| CR-014 | Emoji utility tests | **Resolved** |
| CR-018 | Rate limiting on endpoints | **Resolved** |
| CR-023 | InviteStore race conditions | **Mitigated** (single-process safe) |
| CR-024 | Invite GET increments use count | **Resolved** (separate redeem endpoint) |
| CR-032 | getMessage O(n) scan | **Still present** |
| CR-035 | Keybinding conflict detection | **Resolved** |
| CR-040 | Template duplication in Message.svelte | **Still present** |
| CR-041 | File size limit before upload | **Still missing** client-side |
| CR-042 | Search runs synchronously | **Resolved** (debounced) |
| CR-046-048 | SSRF/invite/file upload tests | **Resolved** |
| CR-049 | Duplicated ROLE_MAP | **Resolved** |
| CR-050 | Inconsistent event prop naming | **Partially resolved** |
| CR-051 | Accessibility gaps | **Mostly unresolved** (see Section 3) |
| CR-053 | Code duplication | **Partially resolved** |
| CR-057-060 | Performance optimizations | **Partially resolved** |

---

## Issue Count Summary

| Category | Count |
|----------|-------|
| Critical/High (security) | 3 |
| High (accessibility) | 5 |
| High (architecture) | 1 (large components) |
| Medium | 35 |
| Low | 55 |
| **Total** | **~99** |
| Resolved since last review | 5 |

### Top 10 Actionable Items (Effort vs Impact)

1. **Add focus trapping utility** -- Fixes all modal accessibility issues at once
2. **Extract shared `<ContextMenu>` component** -- Eliminates 3x duplication, fixes keyboard nav
3. ~~**Unify localStorage SSR guard strategy**~~ -- **RESOLVED**: All files now use `hasLocalStorage()`
4. **Standardize API error return patterns** -- Pick one approach across all API modules
5. **Create CSS design tokens for shadows, overlays, z-index** -- Fixes ~20 hardcoded value issues
6. ~~**Fix channel prefix checks**~~ -- **RESOLVED**: Already consistent (all check both `#` and `&`)
7. **Add tests for `lifecycle.ts`, `messageActions.ts`, `shortcuts.ts`** -- Largest untested modules
8. ~~**Replace `#fff` with `var(--text-inverse)`**~~ -- **RESOLVED**: Components already use `var(--text-inverse, #fff)` fallback pattern
9. **Add syntax highlight CSS custom properties** -- Makes code blocks theme-aware
10. ~~**Update README stats and TODO.md stale items**~~ -- **RESOLVED**: Stats and stale items updated

---

## Post-Review Fix Log

### Fixes Applied (task_3da8ac21-f6e)

| ID | Issue | Resolution |
|----|-------|------------|
| CR-F-INC-03 | Inconsistent localStorage SSR guards | **FIXED**: Replaced all inline `typeof localStorage` checks with `hasLocalStorage()` in appSettings.svelte.ts, theme.svelte.ts, user.svelte.ts, keybindings.ts, auth.ts |
| CR-F-NEW-05 | ResizeHandle has ARIA but no keyboard handler | **FIXED**: Added Arrow key (10px step), Home/End (min/max) keyboard support + focus-visible style |
| CR-F067 | Missing SSR guards for localStorage | **FIXED**: Added `hasLocalStorage()` guards to theme.svelte.ts `persist()` and `persistServerThemePrefs()` |
| CR-F016 | Textarea missing focus ring | **Already fixed**: Has `:focus-visible` with accent outline (MessageInput.svelte:1024-1028) |
| CR-F074 | Hardcoded `#fff` throughout | **Already fixed**: Components use `var(--text-inverse, #fff)` fallback pattern |
| CR-F075 | Non-existent `--status-error` token | **Already fixed**: No references found in codebase |
| CR-F-INC-02 | Inconsistent channel prefix checks | **Already fixed**: handler.ts:593 checks both `#` and `&`; all other locations consistent |
| CR-F062 | rawTarget not null-checked | **Already fixed**: All handlers guard with `if (!rawTarget) return` |
| CR-F060 | getMessage not reactive | **Already fixed**: Reads `_version` at line 176 |
| CR-F001 | TOCTOU DNS rebinding | **Already fixed**: `resolvePinnedUrl()` pins resolved IP |
| CR-F007 | Missing IPv6 all-zeros check | **Already fixed**: `::` check at line 117, `100::/64` and `2001:db8::/32` at lines 124-125 |
| CR-F006 | OG tag XSS | **Already fixed**: `sanitizeOgValue()` strips HTML tags |
| CR-F-NEW-03 | Custom emoji URL validation | **Already fixed**: lifecycle.ts validates http(s) only |
| CR-F-NEW-04 | WebSocket URL validation | **Already fixed**: Login validates `ws://` or `wss://` pattern |
| CR-F042 | Magic string `_input_` | **Already fixed**: Uses `__emoji_input__` (double-underscore prefix) |
| CR-F071 | audioSettings validation | **Already fixed**: videoQuality validated, outputVolume clamped to 0-200 |
| CR-F008 | CSS injection via role colors | **Already fixed**: `isSafeColor()` validates against regex |
| CR-F041 | renderCodeBlocks dead code | **Intentional**: Exported standalone utility with 12+ tests; documented as step 0 in pipeline comment. Not called in production but available as public API |
| Docs | README stats and TODO.md stale items | **FIXED**: Updated commit count, source lines, stale TODO items, Known Deferrals contradictions |
