# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-17

### Added

- Real-time chat with mIRC formatting, replies, reactions, typing indicators,
  message editing/deletion, read markers, pinned messages, spoiler text, and
  syntax-highlighted code blocks
- LiveKit-powered voice channels with mute/deafen, push-to-talk, device
  selection, mic testing, speaker detection, and DM video calls
- Drag-and-drop file uploads with inline image, video, and audio players, plus
  Open Graph link preview cards
- Channel categories, direct messages, per-channel notification settings, and
  channel topic editing
- Role-grouped member list with online/idle/DND/offline presence indicators,
  user profile popovers, and live presence tracking via MONITOR
- Server management with settings modal, invite link system
  (create/validate/expire/revoke), custom server emoji, role colors, and
  welcome messages
- Native desktop app via Tauri 2 (Windows .msi/.exe, macOS .dmg, Linux
  .deb/.AppImage)
- Three-column responsive layout with four themes (dark, light, AMOLED,
  compact), resizable columns, keyboard shortcuts, and customizable keybindings
- Account management with display name editing, email/password change, and
  persistent login via OS keychain storage
- File service (accord-files) with Hono/Bun backend for upload handling and
  LiveKit token provisioning
- Docker Compose deployment with Ergo IRC server, LiveKit SFU, MariaDB, and
  Caddy reverse proxy
