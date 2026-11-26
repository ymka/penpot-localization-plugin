# Penpot Localization

A no-build Penpot plugin prototype that switches tagged design text using reusable JSON translation keys. Translations come exclusively from a local file you select; there is no translation service, API key, backend, or telemetry.

**Status: unreleased prototype with successful user-reported testing in Penpot.** See [the validation record](docs/TESTING.md#validation-record) for evidence and remaining coverage.

## Run locally

You need a local copy of this repository, Python 3.9+, and a browser with access to [design.penpot.app](https://design.penpot.app). No build step or dependency installation is required. Node.js is only needed for development tests.

1. Run `python3 server.py` from this repository.
2. Open [the local manifest](http://localhost:4400/manifest.json) to check that it is served.
3. Open a disposable Penpot design, then open Plugin Manager from its toolbar or menu.
4. Install using `http://localhost:4400/manifest.json` and launch **Penpot Localization**.

Keep the terminal running while using the plugin; stop the server with **Ctrl+C** when finished. The server binds to loopback and serves only `manifest.json`, `plugin.js`, and `index.html`. Translation files are read by the browser's file picker, never served by this development server.

For an existing installation, reinstall from the same manifest to pick up the added `allow:localstorage` permission before testing saved imports.

## Prepare and switch text

1. Rename a **text layer** to `i18n.login.title`; leave its displayed text as it is.
2. Reuse that name on any text layers that share the same translation.
3. Review the scope. It defaults to **Current page only** on each launch; choose **All pages in this file** to update the entire design file. Use **Switch to RTL** or **Switch to LTR** to update text direction and supported layout in that scope immediately. You can switch direction before importing translations.
4. Import your translation JSON file, or use the saved copy restored for this design file. Change the language to apply it immediately. Reimporting JSON automatically reapplies the selected language when the new dictionary includes it.
5. The prominent apply button is always visible: **Apply to current page** / **Apply to all pages** names the chosen scope, **Applying…** marks an update in progress, and **Try again** follows a failed update. Use it to reapply the selected language at any time, including after adding tagged text or reopening. It is disabled without a selected language or while busy.
6. After this plugin session changes text, **Restore current page** / **Restore all pages** returns eligible layers to the text first observed before the session's uninterrupted plugin-written sequence. Layers edited outside the plugin, deleted outside the plugin before Restore, otherwise missing, or using mixed styles are reported and left unchanged. Restore never deletes or recreates layers. Conflicting controls are disabled until the current apply or restore finishes; wait for its result.

Layer names are case sensitive. The key after the exact `i18n.` prefix is trimmed and matched literally: `i18n.login.title` matches the flat key `"login.title"`, not a nested object. Repeated keys update every matching text layer in scope; untagged text stays unchanged.

Changing language, successfully reimporting JSON with the selected language, or pressing the enabled apply button edits the design immediately. On pages without a chosen direction, recognized RTL codes also apply RTL direction and smart alignment to matching text. The direction buttons work independently of translation Apply. A first import with no selected language waits for a choice. If a reimport lacks the selected language, the selection is cleared without applying. Before reading a selected file, the UI captures the current design file/page through the adapter. If the active page changes during a page-scoped read, the new dictionary can load and save but automatic application is rejected; review the scope and use Apply. All-pages scope remains valid across active-page navigation. Reopening the plugin, changing scope, forgetting saved data, and rejected/canceled imports do not change design text. The button remains available after a successful update, so newly added tagged text can be translated using the loaded dictionary. Use a disposable copy while testing.

Each mutating Apply, direction switch, or Restore is placed in one Penpot history block. This is history grouping, not an automatic rollback: successful writes can remain when another layer fails, and the result reports partial failures. Restore is an additional safety path. Text recovery exists only in the open plugin session and stores text, file/page/shape IDs, and the last plugin-written text—not Penpot proxy objects or styles. Direction choices and style/layout baselines are stored as versioned plugin data on pages and affected shapes so they remain reversible after reopening. These records contain no text. Restore writes only when current managed values still match the last plugin write. Repeated language switches keep the first uninterrupted text baseline; an explicit Apply after divergent text starts a new text baseline. External RTL style/layout changes are conflicts and remain untouched. Successful restores return managed values to their baselines and clear the chosen page direction. Closing and reopening clears text recovery but not eligible RTL style/layout recovery.

### RTL text and layout

For pages without a chosen direction, RTL language detection is case-insensitive and does not change exact, case-sensitive translation selection. The built-in RTL base codes are `ar`, `ckb`, `dv`, `fa`, `he`, `ps`, `sd`, `ug`, `ur`, and `yi`; the script subtags `Arab`, `Hebr`, `Thaa`, `Nkoo`, `Adlm`, `Rohg`, `Syrc`, and `Mand` also select RTL behavior. Matching text uses `rtl` direction, swaps left/right alignment, and preserves centered or justified alignment. Applying an LTR language restores the recorded direction/alignment instead of forcing a generic style.

**Switch to RTL** and **Switch to LTR** set direction and adjust alignment for eligible text layers, including untagged layers, and mirror supported layout where needed. The switch leaves text content and the selected language intact. The plugin remembers the chosen direction per page, and subsequent translation applies preserve text direction and layout on those pages.

When opening a page for the first time, the plugin infers direction from explicit text directions and any recorded layout mirroring. If direction is known, it shows the reverse action. Mixed or unknown scopes offer both actions. If a page's layout direction cannot be inferred, choosing either direction mirrors the supported layout from its current geometry. In all-pages scope, each page uses its own starting direction. The result reports the text and layout updated along with any skips, conflicts, or failed writes.

Mirroring keeps top-level boards fixed and transforms supported descendants, including plain or absolute horizontal positions, left/right constraints, asymmetric padding and margins, flex row direction, and horizontal start/end alignment in column flex layouts. Artwork, glyphs, rotations, and interactions keep their orientation. Grid and component layout subtrees are skipped. Text layers with mixed direction or alignment, unsupported layout targets, unreadable recovery metadata, externally modified managed properties, and host-rejected properties are reported.

## Translation JSON

Save a UTF-8 JSON file with language-first maps, for example:

```json
{
  "EN": { "login.title": "Welcome back" },
  "ES": { "login.title": "Bienvenido de nuevo" },
  "FR": { "login.title": "Bon retour" },
  "ZH": { "login.title": "欢迎回来" }
}
```

The plugin loads the saved import and language for the current Penpot design file. If none is saved, the language dropdown starts disabled with no default dictionary. **Choose a language** is a disabled placeholder, not a selectable language. Use **Choose JSON file…** to load your file. **Source** shows the active filename, and **Replace or reload JSON…** opens the picker to refresh or replace it. Its language codes populate the dropdown, including custom codes such as `de-DE` and `JA`.

Common language codes display English names, including **Arabic (AR)**, **Portuguese (PT)**, and **Hindi (HI)**. Labels recognize upper/lowercase codes and use the base language for regional or script variants, for example **Portuguese (pt-BR)** and **Chinese (zh-Hans)**. The original code stays unchanged and case sensitive for translation selection; unknown codes display as entered. Only languages present in your JSON appear.

| Item | Accepted input |
| --- | --- |
| File | UTF-8 JSON, at most 1 MiB; an initial UTF-8 BOM is tolerated. Malformed UTF-8 is rejected. Use double quotes, without comments or trailing commas. |
| Languages | 1–64 language maps. Codes are case sensitive: 2–8 ASCII letters, optionally followed by hyphen-separated segments of 1–8 ASCII letters/digits, at most 35 characters in total. This checks syntax, not a language registry. |
| Keys | Flat, nonblank strings of 1–200 characters with no surrounding whitespace. Dots are literal. |
| Values | Strings of up to 20,000 characters. Empty strings intentionally clear matching text; nested objects are rejected. |
| Total entries | At most 10,000 across all language maps. Empty language maps are valid; an empty top-level dictionary is rejected. |

String length limits use JavaScript's UTF-16 length, so some characters, including many emoji, count as two. The file limit counts UTF-8 bytes.

Missing keys leave the layer's **current text** unchanged; there is no fallback language. If a key exists in ES but is missing in FR, switching from ES to FR leaves that layer's Spanish text in place. The session recovery journal records only text the plugin actually changes; it does not supply missing translations. Include every tagged key in each language to avoid a mixture of languages.

A valid import replaces the active dictionary and saves a copy of the JSON contents, filename, and selected language in this browser, separately for each Penpot **design file**, not project folder. When the selected language is present, it is automatically reapplied using the new strings and chosen scope. Invalid, unreadable, oversized, or canceled imports preserve the previous dictionary and saved copy without applying. Translations are never uploaded or written back to the original JSON file. Saved copies are not shared with collaborators or other browsers/devices.

Reopening restores the saved copy and language without applying them. **Source** marks it as a saved copy; the original local file has not been reopened. The import button opens a native file picker, while its empty filename display stays hidden to avoid conflicting with the active saved source. Use **Replace or reload JSON…** and reselect an edited JSON file to refresh the copy. Canceling or rejecting a replacement preserves the active source. **Forget saved file** removes the current design file's saved copy and clears its active import/selection; it does not delete the original file or revert design edits. Other design files keep their saved copies.

Browser storage can be cleared, denied, or run out of space. The storage status reports save/load/delete failures separately; imports remain usable for the session when storage fails, but an older saved copy may remain. Failed save requests do not prevent language changes or valid reimports from applying. Failed forget requests retain the active import and release the controls for retrying. If the startup request cannot be sent, reopen the plugin to identify the design file before applying. Closing the plugin does not revert design edits. If you switch design files while the plugin is open, reopen it before continuing; requests for a different file are rejected.

## Known limitations

- Text layers with mixed per-character styles are skipped without changing their text; rich-text translation is not supported. Uniformly styled layers are updated through Penpot's whole-text setter. Long translations, line breaks, grow settings, missing fonts, and CJK glyph coverage can affect wrapping and layout. The [optional compatibility checks](docs/TESTING.md#optional-penpot-compatibility-checks) can help investigate environment-specific behavior; no broad Penpot/browser version range is claimed.
- Restore recovers session text plus eligible RTL style/layout baselines, but not layers deleted outside the plugin or values that diverged from the last plugin write. It does not recreate layers. Text recovery is cleared when the plugin closes; RTL metadata contains styles/layout only and stays on affected shapes. Apply, direction switching, and Restore use grouped history; cross-page undo/redo and history-failure behavior have not been broadly characterized across Penpot environments. There is no automatic rollback; partial failures are reported and successful writes can remain.
- Import, language, scope, forget, reapply, direction, and restore controls are disabled during design updates. Penpot navigation and external edits remain outside these UI locks. Page-scoped reimports reject a changed active page before writes; file changes are rejected. External edits can still create reported apply/restore conflicts.

Interpolation, pluralization, machine translation, grid/component mirroring, directional-artwork flipping, font substitution, and arbitrary layout repair are outside v0.1.0 scope. Planned safety work is tracked in [the release plan](docs/V0_1_0_PLAN.md).

## Troubleshooting

- **Plugin will not load:** check that the server is running and the manifest URL opens. Inspect blocked or missing requests in the browser console/network panel. Local-network or mixed-content policies can affect loading; keep browser security enabled. See [Penpot's loading instructions](https://help.penpot.app/plugins/create-a-plugin/).
- **Language dropdown disabled or import rejected:** check the status message and the [JSON requirements](#translation-json), then select a valid file and wait for reading to finish.
- **Missing keys or no layers updated:** compare reported keys with the selected language map, check text-layer names and scope, and reselect the JSON file after saving changes. Status distinguishes already-matching text, missing keys, and failed updates.
- **404 at `/` or `/translations.json`:** expected. Install through `/manifest.json` and import translations through the plugin's file picker.

## Development

Start with [CONTRIBUTING.md](CONTRIBUTING.md). [Project context](docs/PROJECT_CONTEXT.md) describes architecture and decisions; [TESTING.md](docs/TESTING.md) contains the automated commands and manual checks. [AGENTS.md](AGENTS.md) provides coding-agent standards.

## License and publication

MIT is recommended, but the owner must choose a license and copyright attribution before a root `LICENSE` is applied. No license has been applied yet, so this is not an open-source release. Review terms for reused code and assets. See the [MIT license text](https://opensource.org/license/mit); [MPL-2.0](https://www.mozilla.org/en-US/MPL/2.0/) is an alternative if the owner prefers changes to the plugin's source files to remain open, subject to its obligations.

Public GitHub hosting and Plugin Hub submission are planned after the release package and license decision are complete. Publishing, pushing, deploying, and submitting require explicit owner approval; selecting a license does not authorize those actions.
