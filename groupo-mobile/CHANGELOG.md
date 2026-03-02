# Changelog

All notable changes to Groupo Mobile are documented in this file.

## [1.2.0] - 2026-03-02

### Added
- First-class Albums support across backend and mobile app.
- Albums tab and album detail/settings screens.
- Group page tabs: Posts, Albums, Members.
- Ability to create albums inside groups.
- Automatic member propagation: new group albums include all current group members.
- Multi-album posting support (single post associated with multiple albums).
- Post card "Albums" button to jump to associated album pages.
- Account settings features: update name/phone, change password, delete account.
- Add group/album member by username or phone number.
- Post composer media thumbnail grid with tap-to-remove.
- Post composer draft discard action.
- Carousel dots for multi-media posts.

### Changed
- Posts now publish to albums (group-level post creation is blocked; users select albums).
- Group post feed now aggregates posts from that group's albums, ordered by newest first.
- Group rename behavior is user-specific (alias per user) instead of global.
- Push token registration now enforces one token per user session to prevent cross-account notification leakage on shared test devices.
- TestFlight release runbook added.

### Fixed
- Comment notifications now notify expected recipients (excluding only the actor).
- Like notifications added and stabilized.
- Like count now limited to one like per user per post.
- Album/navigation state bugs (stale album names, incorrect back navigation from album settings).
- Post composer preview gating now blocks preview when no album is selected.
- Multiple startup migration issues on persistent Render SQLite disk (missing schema columns/tables, including `post_album` and `post_like`).
- Various keyboard/layout issues in settings and group/album settings forms.

### Infrastructure
- Render startup/database compatibility hardening for persistent SQLite deployments.
- Schema backfill for legacy rows (`group.kind`).

## [1.1.0] - Previous
- Prior mobile/feed/group functionality and fixes.
