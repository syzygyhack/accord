# Code Review: virc MVP

**Date:** 2025-02-12
**Scope:** All files in `virc-client/src/` and `virc-files/src/`, plus all test files.
**Reviewed:** 45 source files, 20 test files, 19 Svelte components.

---

## Critical Issues

### SEC-1: XSS risk in Message.svelte via `{@html}`

**File:** `virc-client/src/components/Message.svelte:161,173`

Message text is rendered with `{@html renderedText()}`, where `renderedText` chains `renderIRC()` -> `linkify()` -> `highlightMentions()`. The pipeline depends on `renderIRC()` calling `escapeHTML()` on each character before wrapping in formatting tags.

**Current mitigation:** `format.ts:38-44` escapes `&`, `<`, `>`, `"` per character in `escapeHTML()`. This runs before any HTML tags are inserted.

**Remaining risks:**
- `linkify()` calls `escapeHTML(url)` for the `href` attribute but does NOT escape the display text: `>${display}</a>`. If `renderIRC()` has already escaped the text, this is safe, but `linkify` is a public function that could be called independently on unescaped text.
- `highlightMentions()` wraps `@name` and `#channel` matches into `<span>` tags. The matched text (`match`) is inserted unescaped. If the match contains HTML entities that were already escaped by `renderIRC`, this is safe in the current pipeline order. But if `highlightMentions` is ever called on raw text, it's an XSS vector.
- The pipeline order is critical and undocumented. Reordering `renderIRC` -> `linkify` -> `highlightMentions` would break the safety guarantee.

**Severity:** CRITICAL -- the current code is safe but fragile. Any change to the pipeline order or independent use of `linkify`/`highlightMentions` on unsanitized text creates XSS.

### SEC-2: No CSRF protection on virc-files endpoints

**File:** `virc-files/src/routes/auth.ts`, `virc-files/src/routes/livekit.ts`

The `/api/auth` endpoint accepts POST with JSON body and has no CSRF token or origin validation. While JWT-based APIs are less susceptible to CSRF (the token must be explicitly sent in the Authorization header), the auth endpoint itself doesn't require a token -- it issues one. If the virc-files server sets any cookies (e.g., from Hono middleware), CSRF becomes exploitable.

The `/api/livekit/token` endpoint requires a Bearer JWT, which mitigates CSRF since browsers don't auto-attach Authorization headers.

**Severity:** CRITICAL (for `/api/auth` if cookies are ever introduced; currently medium risk).

### SEC-3: `editLastMessage` redacts before user confirms edit

**File:** `virc-client/src/routes/chat/+page.svelte` (editLastMessage function)

When a user presses Up to edit their last message, the code immediately sends a `REDACT` command to the server, permanently deleting the original message before the user has even modified the text. If the user cancels the edit, the original message is already gone.

**Severity:** CRITICAL -- data loss with no undo path.

---

## Major Issues

### A11Y-1: Widespread suppression of Svelte accessibility warnings

**Files:** `chat/+page.svelte`, `QuickSwitcher.svelte`, `AuthExpiredModal.svelte`, `MemberList.svelte`, `HeaderBar.svelte`, `Message.svelte`, `EmojiPicker.svelte`

At least 15 instances of `<!-- svelte-ignore a11y_click_events_have_key_events -->` and `<!-- svelte-ignore a11y_no_static_element_interactions -->` suppress real accessibility problems. Interactive `<div>` elements use `onclick` without `onkeydown`, `role`, or `tabindex`.

**Severity:** MAJOR -- keyboard-only and screen reader users cannot interact with significant UI elements.

### A11Y-2: No ARIA dialog semantics on any modal

**Files:** `chat/+page.svelte` (delete dialog), `AuthExpiredModal.svelte`, `QuickSwitcher.svelte`, `EmojiPicker.svelte`

None of the modal/popup components use `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, or focus trapping. Users relying on assistive technology cannot properly interact with modals. Focus is not returned to the trigger element on close.

**Severity:** MAJOR

### A11Y-3: Message action toolbar only appears on hover

**File:** `virc-client/src/components/Message.svelte:110-128`

The Reply, React, and More buttons are only visible when `hovered` is true (set by `onmouseenter`/`onmouseleave`). Keyboard-only and touch users have no way to access message actions.

**Severity:** MAJOR

### A11Y-4: Missing `aria-live` regions for dynamic content

**Files:** `TypingIndicator.svelte`, `ConnectionBanner.svelte`, `MessageInput.svelte` (status message)

Dynamic status messages (typing indicators, connection loss banners, rate limit status) have no `role="status"`, `role="alert"`, or `aria-live` attributes. Screen readers will not announce these changes.

**Severity:** MAJOR

### LEAK-1: Event listener leak in login page

**File:** `virc-client/src/routes/login/+page.svelte`

`waitForWelcome()` and `waitForRegistration()` attach `conn.on('message', ...)` listeners that are never removed after the promise resolves or rejects. The `IRCConnection` class has no `off()` or `removeListener()` method, so these handlers accumulate on the connection object.

**Severity:** MAJOR -- listener accumulation on reconnect cycles.

### LEAK-2: IRCConnection has no listener removal API

**File:** `virc-client/src/lib/irc/connection.ts:109-113`

`IRCConnection.on()` pushes handlers but provides no way to remove them. The `cap.ts` negotiation acknowledges this in a comment (line 101-103: "We can't remove listeners from IRCConnection's current API"). This means:
- Temporary listeners (CAP negotiation, SASL auth, login wait) persist forever.
- On reconnect, new listeners are added without removing old ones.

**Severity:** MAJOR -- architectural gap causing cumulative memory/CPU waste.

### ERR-1: Missing error feedback for voice connection failures

**File:** `virc-client/src/routes/chat/+page.svelte`

`handleVoiceChannelClick` catches errors with `console.error` but does not surface the error to the user in the UI. Voice connection failures are silent.

**Severity:** MAJOR

### PERF-1: Duplicate member state tracking

**Files:** `virc-client/src/lib/state/channels.svelte.ts`, `virc-client/src/lib/state/members.svelte.ts`

Channel members are tracked in two parallel data structures:
- `channels.svelte.ts`: `ChannelInfo.members: Map<string, ChannelMember>` (nick, account, prefix)
- `members.svelte.ts`: `memberState.channels: Map<string, Map<string, Member>>` (nick, account, modes, presence, away)

Every JOIN, PART, QUIT, and NICK operation must update both stores (visible in `handler.ts` where `addMember`/`removeMember` are called twice with different imports). This duplication risks desync and doubles memory usage.

**Severity:** MAJOR -- architectural tech debt.

### PERF-2: `firstUnreadMsgid()` called per message entry in MessageList

**File:** `virc-client/src/components/MessageList.svelte`

`firstUnreadMsgid` is defined as `$derived(() => { ... })` (function form) and is called in the template loop for each message entry. Each call re-executes a `findIndex` over all messages. This is O(entries * messages) instead of O(messages).

**Severity:** MAJOR -- performance degrades quadratically with message count.

---

## Minor Issues

### CODE-1: Duplicate `MODE_PRECEDENCE` constant

**Files:** `virc-client/src/lib/irc/handler.ts:178`, `virc-client/src/lib/state/members.svelte.ts:10`

The mode precedence array `['~', '&', '@', '%', '+']` is defined independently in both files. The `computeHighestMode` function is also duplicated.

### CODE-2: Duplicate `TYPING_TIMEOUT_MS` constant and typing logic

**Files:** `virc-client/src/lib/irc/handler.ts:63`, `virc-client/src/lib/state/typing.svelte.ts:8`

Handler.ts has its own typing state management (`typingState`, `typingTimers`, `setTyping`, `clearTyping`) with `TYPING_TIMEOUT_MS = 6_000`. The typing.svelte.ts store also defines `TYPING_TIMEOUT_MS = 6_000` with its own independent typing state. The handler uses its own typing maps (module-level `Map<string, Set<string>>`), while the Svelte store uses `$state`. It's unclear which one components should read.

### CODE-3: Inconsistent `$derived` patterns across components

**Files:** Multiple Svelte components

Some deriveds use the value form (`$derived(expression)`) while others use the function form (`$derived(() => { ... })`). The function form creates a callable that must be invoked with `()`. This inconsistency appears in: `Message.svelte`, `MessageList.svelte`, `MessageInput.svelte`, `QuickSwitcher.svelte`, `MemberList.svelte`, `HeaderBar.svelte`.

### CODE-4: Unused variable in MessageInput.svelte

**File:** `virc-client/src/components/MessageInput.svelte:192`

`const newEnd = end + wrapper.length * 2;` is computed but never used.

### CODE-5: `handleMore` accepts unused event parameter

**File:** `virc-client/src/routes/chat/+page.svelte`

`handleMore(_event: MouseEvent)` accepts and ignores the event parameter.

### CODE-6: Global window events for cross-component communication

**File:** `virc-client/src/routes/chat/+page.svelte`

`virc:edit-message` and `virc:insert-mention` custom events dispatched on `window` are a fragile pattern. If multiple component instances existed, all would receive the event.

### CODE-7: CSS selector injection risk in MessageList

**File:** `virc-client/src/components/MessageList.svelte:213`

`scrollContainer.querySelector(`[data-msgid="${msgid}"]`)` does not escape the msgid value. If msgid contains CSS selector special characters, the query would break.

### CODE-8: Hardcoded colors in ConnectionBanner

**File:** `virc-client/src/components/ConnectionBanner.svelte`

`color: #1a1a1a` and `background: #1a1a1a` are hardcoded rather than using the CSS custom properties defined in `app.css`.

### CODE-9: `getCredentials` returns unsanitized JSON.parse result

**File:** `virc-client/src/lib/api/auth.ts:37`

`JSON.parse(raw) as StoredCredentials` does not validate the parsed shape. If sessionStorage is tampered with, the cast could produce an object missing required fields.

### CODE-10: Typing timer not cleaned on MessageInput destroy

**File:** `virc-client/src/components/MessageInput.svelte`

The `typingDoneTimer` setTimeout is not cleared in `onDestroy`. If the user navigates away mid-typing, the timer fires and attempts to send a `typing: done` TAGMSG on a potentially stale connection.

### CODE-11: VoicePanel `handleDisconnect` does not await promise

**File:** `virc-client/src/components/VoicePanel.svelte`

`disconnectVoice(room)` returns a Promise but the result is not awaited. Disconnection errors are silently dropped.

### CODE-12: ErrorBoundary retry can infinite loop

**File:** `virc-client/src/components/ErrorBoundary.svelte`

If the error is persistent (e.g., a rendering error in a child component), clicking "Try Again" sets `error = null`, which re-renders the child, which immediately throws again.

### CODE-13: TypingIndicator polls every 1 second unconditionally

**File:** `virc-client/src/components/TypingIndicator.svelte`

A `setInterval` increments a `tick` counter every second to force re-derivation of typing users. This runs continuously even when nobody is typing.

### CODE-14: MemberList context menu not keyboard accessible

**File:** `virc-client/src/components/MemberList.svelte`

Right-click context menu has no keyboard trigger (Shift+F10 or menu button), no `role="menu"`, no arrow key navigation, and no focus trap. The menu can appear off-screen without viewport boundary checking.

### CODE-15: Missing `role="log"` on MessageList scroll container

**File:** `virc-client/src/components/MessageList.svelte`

The message scroll container should have `role="log"` and `aria-live="polite"` to communicate its nature as a chat log to assistive technology.

### CODE-16: QuickSwitcher lacks ARIA combobox pattern

**File:** `virc-client/src/components/QuickSwitcher.svelte`

The selected item is visually highlighted but not communicated via `aria-activedescendant`, `role="listbox"`, or `role="option"`. Missing `role="dialog"` on the container.

### CODE-17: Nick display in Message.svelte appears clickable but has no handler

**File:** `virc-client/src/components/Message.svelte`

The `.nick` span has `cursor: pointer` CSS and `:hover` underline styling but no `onclick`, `onkeydown`, `role`, or `tabindex`. It looks interactive but does nothing.

---

## Test Coverage Assessment

### Well-Tested Areas

| Module | Test File | Coverage |
|--------|-----------|----------|
| IRC parser | `parser.test.ts` | Good -- parses tags, prefixes, params, edge cases |
| IRC format | `format.test.ts` | Good -- XSS escaping, all formatting codes, linkify, mentions |
| IRC connection | `connection.test.ts` | Good -- connect, reconnect, backoff, buffering |
| IRC handler | `handler.test.ts` | Excellent -- PRIVMSG, TAGMSG, REDACT, JOIN, PART, QUIT, NICK, MODE, TOPIC, NAMES, BATCH, MONITOR, WHO, WHOX, AWAY |
| IRC commands | `commands.test.ts` | Good -- all command helpers |
| IRC CAP | `cap.test.ts` | Good -- multiline, filtering, NAK |
| IRC SASL | `sasl.test.ts` | Good -- success, failure, CAP END |
| State: messages | `messages.svelte.test.ts` | Excellent -- add, get, redact, reactions, prepend, cursors, eviction |
| State: members | `members.svelte.test.ts` | Excellent -- CRUD, presence, modes, sorting, grouping |
| State: notifications | `notifications.svelte.test.ts` | Good -- unread, mentions, markRead |
| State: typing | `typing.svelte.test.ts` | Good -- set, clear, expiry |
| State: connection | `connection.svelte.test.ts` | Good -- all state transitions |
| State: user | `user.svelte.test.ts` | Good -- login, logout, rehydrate |
| State: voice | `voice.svelte.test.ts` | Good -- connect, disconnect, mute, deafen, participants |
| API auth | `auth.test.ts` | Good -- credentials, JWT fetch, refresh timer |
| Keybindings | `keybindings.test.ts` | Good -- matching, modifiers, unregister |
| Emoji | `emoji.test.ts` | Good -- search, categories |
| virc-files auth | `tests/auth.test.ts` | Good -- validation, Ergo integration, JWT shape |
| virc-files config | `tests/config.test.ts` | Good -- JSON response, ETag, 304 |
| virc-files livekit | `tests/livekit.test.ts` | Good -- auth required, token generation |
| virc-files middleware | `tests/middleware.test.ts` | Good -- rejection cases, valid token |

### Untested Areas

| Area | Risk Level | Notes |
|------|-----------|-------|
| Svelte components (all 19) | HIGH | Zero component tests. No rendering, interaction, or integration tests for any UI component. |
| `voice/room.ts` | MEDIUM | LiveKit integration wrapper has no tests. Difficult to test without mocking livekit-client. |
| `state/channels.svelte.ts` (UI state) | MEDIUM | DM conversations, categories, active channel functions are untested. Channel data functions are tested via handler integration. |
| `state/presence.svelte.ts` | LOW | Simple Set operations, tested indirectly via handler.test.ts. |
| `state/servers.svelte.ts` | LOW | Simple CRUD, no direct tests. |
| Reconnect + re-auth flow | HIGH | The full flow of reconnect -> re-SASL -> re-join -> history fetch is not tested end-to-end. |
| DM routing in handler | MEDIUM | `handlePrivmsg` DM logic (incoming DM detection, buffer target resolution) is not directly tested. |
| Error paths in auth.ts | LOW | `fetchToken` error path tested, but `startTokenRefresh` failure callback is not tested with real error scenarios. |

---

## Security Summary

| ID | Issue | Severity | Status |
|----|-------|----------|--------|
| SEC-1 | XSS in message rendering pipeline | CRITICAL | Safe but fragile -- pipeline order undocumented |
| SEC-2 | No CSRF on `/api/auth` | CRITICAL | Low risk currently, high if cookies added |
| SEC-3 | Edit-last-message redacts prematurely | CRITICAL | Data loss |
| LEAK-1 | Event listener leak in login | MAJOR | Memory/CPU waste |
| LEAK-2 | No listener removal API on IRCConnection | MAJOR | Architectural gap |

---

## Recommendations (Priority Order)

1. **Document and enforce the HTML sanitization pipeline** in `format.ts`. Add JSDoc warnings that `linkify` and `highlightMentions` MUST only be called on pre-escaped text. Consider consolidating into a single `renderMessage(text, myAccount)` function that enforces the correct order.

2. **Add `off()` / `removeListener()` to IRCConnection** to prevent listener accumulation.

3. **Fix `editLastMessage` to NOT redact until the edit is confirmed.** Store the original text, show it in the input, and only redact + re-send on submit.

4. **Consolidate duplicate member state** into a single store (likely `members.svelte.ts` since it's the richer model).

5. **Add ARIA semantics to modals and dynamic regions** -- `role="dialog"`, `aria-modal`, focus trapping, `aria-live` on status areas.

6. **Add component tests** for at least the critical interaction paths: `Message.svelte` (rendering, toolbar), `MessageList.svelte` (scrolling, history loading), `MessageInput.svelte` (send, slash commands), `login/+page.svelte` (auth flow).

7. **Resolve the duplicate typing state** between `handler.ts` and `typing.svelte.ts`.

8. **Cache `firstUnreadMsgid` as a value-form `$derived`** in MessageList to avoid O(n^2) behavior.

9. **Make message toolbar keyboard-accessible** via focus-based visibility or a dedicated menu button.

10. **Add CORS/origin checking** to virc-files if it will ever be deployed on a different origin from the client.
