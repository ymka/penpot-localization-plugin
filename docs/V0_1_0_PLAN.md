# v0.1.0 release plan

This document tracks unfinished release work. Implemented behavior and architecture live in [project context](PROJECT_CONTEXT.md); validation evidence lives in [testing](TESTING.md#validation-record). Priorities describe release impact, not confirmed exploits.

## Open work

| Priority | Gap | Completion condition |
| --- | --- | --- |
| P2 | Release package and license incomplete | Complete the package checklist below and the [owner's license decision](../README.md#license-and-publication). |

## Implementation order

1. Planning, history, restore, full request validation, mutation controls, partial-failure results, automatic RTL text direction for pages without a chosen direction and reversible LTR/RTL conversion of text and layout are implemented with automated regression coverage. Automatic language/reimport application preserves layout state. Literal translation and session restore have reported functional use in Penpot. A 2026-11-18 Penpot 2.19.3-RC1 report exposed optional/host-rejected layout values and repeated recovery diagnostics; the adapter now filters unsupported values, isolates property failures, and safely skips unreadable metadata. A post-fix real-host RTL compatibility pass remains optional and pending.
2. Prepare the release package for owner review.

## Release package checklist

- Apply the owner-selected license and attribution; review ownership of reused code, icons, screenshots, and fixtures.
- Prepare versioned runtime assets, static HTTPS hosting with working relative subpaths, privacy information, an icon/screenshots, release notes, and Hub metadata.
- Verify that hosted files contain only intended public assets, and recheck current official Hub submission instructions.
- Obtain explicit approval before pushing, publishing, deploying, or submitting to the Hub. License selection or a successful test does not authorize publication.
