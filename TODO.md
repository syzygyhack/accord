# accord TODO

Work required before publishing. Ordered by priority.

---

## Blockers

### Add LICENSE file
- [ ] Create `LICENSE` at repo root with MIT text
- README claims MIT but no license file exists — project is under exclusive copyright without it

### Commit uncommitted work
- [ ] Stage and commit the 14 modified files + 3 untracked files currently in the working tree
- Includes: voice manager extraction, a11y utilities, navigation extraction, code review fixes

### Remove hardcoded secret from shipped config
- [ ] Replace OAuth2 `client-secret: "4TA0I7mJ3fUUcW05KJiODg"` in `config/ergo/ircd.yaml:623` with a placeholder
- OAuth2 is disabled in the config, but users may copy the file verbatim

---

## Rename to accord

Full project rename. ~200 locations across source, config, tests, and docs.

### Package & project identity
- [ ] `accord-client/package.json` — name field
- [ ] `accord-files/package.json` — name field
- [ ] `accord-client/src-tauri/tauri.conf.json` — productName, identifier (`com.accord.app`), window title
- [ ] `accord-client/src-tauri/Cargo.toml` — crate name (`accord`), lib name (`accord_lib`)
- [ ] Regenerate `Cargo.lock` after Cargo.toml changes

### Directory names
- [ ] Rename current client directory -> `accord-client/`
- [ ] Rename current files directory -> `accord-files/`
- [ ] Update all cross-references to these directories (docker-compose, Caddyfile, README, etc.)

### Custom IRC tag
- [ ] `+accord/edit` in `lib/irc/commands.ts`, `lib/irc/handler.ts`, and all tests
- This is a wire protocol tag — both client and any future third-party clients must agree on the name

### localStorage / keyring namespace
- [ ] `accord:account` (auth.ts)
- [ ] `accord:credentials` (auth.ts)
- [ ] `accord:keyring-pending-delete` (auth.ts)
- [ ] `accord:serverUrl` (login/+page.svelte, AuthExpiredModal, UserSettings)
- [ ] `accord:filesUrl` (login/+page.svelte, Message.svelte, AuthExpiredModal, UserSettings)
- [ ] `accord:appSettings` (appSettings.svelte.ts)
- [ ] `accord:frequent-emoji` (emoji.ts)
- [ ] `accord:keybindingOverrides` (keybindings.ts)
- [ ] Keyring service name `accord` (auth.ts)
- [ ] Update all corresponding test assertions

### Custom events
- [ ] `accord:edit-message`, `accord:insert-mention`, `accord:insert-emoji` (MessageInput.svelte)
- [ ] `accord:scroll-to-message`, `accord:scroll-messages` (MessageList.svelte)
- [ ] `accord:reply`, `accord:react`, etc. in +page.svelte (verify all `window.dispatchEvent` calls)

### JWT & API constants
- [ ] `JWT_ISSUER = "accord-files"` (middleware/auth.ts, routes/auth.ts)
- [ ] `JWT_AUDIENCE = "accord-files"` (middleware/auth.ts, routes/auth.ts)
- [ ] Default server ID `accord.local` (env.ts)
- [ ] Warning message referencing `accord.local` (env.ts)
- [ ] Update all test fixtures in `accord-files/tests/helpers.ts` and individual test files

### API endpoint
- [ ] `/.well-known/accord.json` (config.ts route, discovery.ts client, Caddyfile if proxied)
- [ ] `CONFIG_PATH` default `config/accord.json` (env.ts)
- [ ] Schema URL — update domain (config.ts)

### Docker & infrastructure
- [ ] `docker-compose.yml` — service name `accord-files`, volume names `accord-uploads`/`accord-data`, build path, Caddy mount
- [ ] `config/caddy/Caddyfile` — `reverse_proxy accord-files:8080`, `root * /srv/accord`
- [ ] `accord-files/Dockerfile` — user/group name `accord`
- [ ] `config/ergo/ircd.yaml` — server `name: accord`, network `name: accord.local`, comments

### Environment
- [ ] `.env.example` — all comments referencing accord/accord-files

### Default strings
- [ ] `"accord Server"` default server name (config.ts:64)
- [ ] `"An accord community server"` default description (config.ts:72)
- [ ] `"accord-link-preview/1.0"` User-Agent (preview.ts:336)
- [ ] Console log `accord-files listening on` (index.ts:61)
- [ ] Console error `[accord] InviteStore save failed` (invite.ts:46)

### Documentation
- [x] `README.md` — title, all prose, architecture diagram, project structure, repo URL
- [x] `PLAN.md` — title (`accord — Video IRC`), all references
- [x] `FRONTEND.md` — title, all references
- [x] `TODO.md` — this file (already renamed)
- [ ] `accord-client/src/app.css` — header comment
- [ ] `accord-client/src/lib/constants.ts` — JSDoc comments
- [x] Update README repo URL (`syzygyhack/accord`)

---

## Publish Hygiene

### Add CI pipeline
- [ ] Create `.github/workflows/ci.yml`
- [ ] Run `vitest run` for client tests
- [ ] Run `bun test` for server tests
- [ ] Run `svelte-check` for type checking
- [ ] Trigger on push and PR to main

### Add CHANGELOG
- [ ] Create `CHANGELOG.md` with initial release notes summarizing current feature set

### Bump version numbers
- [ ] `accord-client/package.json` — `0.0.1` -> `0.1.0` (minimum)
- [ ] `accord-files/package.json` — `0.1.0` is acceptable, or bump to match

### Add .dockerignore
- [ ] Create `accord-files/.dockerignore` excluding tests/, node_modules/, *.md, .git

### Fix README drift
- [ ] Test count: 651 -> 899 (744 client + 155 server)
- [ ] Component count: 23 -> 28
- [ ] Update "By the Numbers" table (commits, line counts, test counts)

### Fix svelte-check warnings
- [ ] Migrate deprecated `<slot>` elements to Svelte 5 `{@render}` syntax (24 warnings)
- [ ] Address a11y lint warnings (missing labels, roles, etc.)

---

## Code Quality

### Deduplicate backend constants
- [ ] Extract `JWT_ISSUER`, `JWT_AUDIENCE`, `ERGO_TIMEOUT_MS` into shared `constants.ts`
- [ ] Extract repeated Ergo API fetch+check+parse pattern into `ergoClient` helper (~120 lines saved)

### Reduce +page.svelte complexity
- [ ] Extract `initConnection` (165 lines) into a connection lifecycle module
- [ ] Extract keyboard shortcut registration (~280 lines) into a composable
- [ ] Extract message action handlers (reply, react, edit, delete, pin — ~200 lines)
- [ ] Target: get +page.svelte under 800 lines

### Minor improvements
- [ ] Cache `TextEncoder().encode(JWT_SECRET)` at module level instead of per-request (middleware/auth.ts)
- [ ] Move `getMimeType` map to module-level constant (files.ts)
- [ ] Add typed event map to IRC connection to replace `any` listener types
- [ ] Fix double DNS resolution in preview.ts — reuse IPs from `assertPublicResolution`
- [ ] Add SSR guard (`hasLocalStorage()`) to remaining bare `localStorage` calls in +page.svelte
- [ ] Store `voiceError` auto-dismiss timer refs to prevent premature clearing

---

## Known Deferrals

Not required for initial publish. Documented for future work.

| Item | Notes |
|------|-------|
| Push notifications | Web Push API planned |
| Search | Ergo SEARCH extension available |
| User avatars / bios | Blocked on IRCv3 `draft/metadata-2` |
| Screen sharing / video | Audio only; LiveKit supports it |
| Multi-server | UI accommodates server list; single-server for now |
| Theme customization UI | Dark only; CSS vars ready for theming |
| Custom server emoji | Config structure ready, rendering not wired |
| Voice channel access control | Any authenticated user can get a token for any channel name |

---

## Intentional Deviations from Spec

These differ from FRONTEND.md/PLAN.md by design.

- **Font stack**: system fonts instead of Inter (native feel, no external loading)
- **Font size**: 3 zoom levels (100/125/150%) instead of continuous slider
- **Sidebar overlay**: triggers at 900px (combines spec's two breakpoints)
- **Quick switcher**: global modal (Ctrl+K) instead of inline sidebar search
- **Caddy WebSocket path**: `/ws` instead of spec's `/irc/*`
