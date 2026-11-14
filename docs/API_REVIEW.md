# Penpot Plugin API review

Initial documentation review 2026-11-14; file identity, storage, manifest, messaging, and text-style sources rechecked 2026-11-16; page identity/lookup and history sources rechecked 2026-11-17. This records documented contracts and API assumptions; runtime evidence belongs in [the testing record](TESTING.md#validation-record). Recheck the relevant official sources when changing these integrations.

| Surface | Documented contract and integration note |
| --- | --- |
| Manifest | Relative runtime assets require numeric schema `version: 2`; this is separate from a plugin release version. |
| `penpot.ui.open(name, url, options)` | URL string and optional dimensions. The plugin explicitly loads `index.html`; the guide's empty-URL example was not itself a proven bug. Hosted subpath loading can be checked during release packaging. |
| `ui.onMessage`, `ui.sendMessage` | Callbacks receive messages directly; retain plain payloads rather than another ecosystem's envelope. Rechecked 2026-11-17 for pre-read context capture: context, apply, and restore use plugin-defined positive numeric request IDs, echoed on every response. The UI correlates and validates results and locks conflicting actions while one context/mutation request is pending. These protocols add no host API or permission. |
| UI `parent.postMessage` | Official examples use a plain payload and `"*"`. Validate parent source on replies. Narrow the target origin only after establishing the actual embedding origin, which need not equal the static asset origin. Rechecked 2026-11-17 for context capture: synchronous send failures are handled locally, while foreign/stale/malformed context replies cannot release the read lock or start file reading. Message payloads and permissions are unchanged. |
| Browser file import | `File` inherits `Blob.arrayBuffer()` for raw bytes. Check their length before decoding with `TextDecoder("utf-8", { fatal: true, ignoreBOM: true })`; malformed input throws instead of substituting characters. Preserve the initial BOM in saved text and strip it only for parsing. These are browser APIs used in the UI, not Penpot adapter APIs. |
| `currentPage`, `currentFile` | Nullable proxies; guard absence of an open page/file. Before a local file read, the adapter returns validated file/page IDs as plain data. Page-scoped automatic apply rejects a different current page; file-scoped apply accepts active-page navigation because its target remains every page. Rechecked 2026-11-17 against the Penpot and Page interfaces. |
| `File.id` | Read-only unique design-file identifier. The documented File interface has no project-folder ID. Saved copies are keyed by this ID; save/forget/apply reject a different current-file ID. |
| `penpot.localStorage` | Plugin-owned browser storage; `getItem(key): string`, `setItem(key, value): void`, `removeItem(key): void`, requiring `allow:localstorage`. Store an explicit JSON string; validate parsed records on load and before saving. Treat null/undefined/empty reads as missing, catch permission/quota/storage errors without exposing their contents, and do not assume synchronization or indefinite retention. Real-host persistence and missing-key behavior remain to be observed. |
| `File.pages` | Array of Page proxies; non-active page writes need host confirmation. Page IDs captured from this array are rechecked before file-wide writes. |
| `Page.id`, `findShapes`, `getShapeById` | `id` is the page's unique string identifier; `findShapes({type: 'text'})` returns matching Shape proxies; `getShapeById(id)` returns a shape or `null`. Apply planning captures plain page/shape IDs, and execution/restore resolves targets through the captured page. Confirm descendants, components, lookup after a layer is deleted outside the plugin, and non-active-page lookup in Penpot. |
| `Text.characters` and style properties | `characters` is a writable whole-text string. Aggregate font, spacing, transform, decoration, direction, alignment, and fill properties document `"mixed"` when multiple values apply. Before a changed whole-text write, the plugin checks every documented mixed-capable property and skips the layer if any is mixed. `TextRange.characters` is read-only, so the current flat translation contract cannot safely map replacement content to style ranges. Real-host detection and uniform-style preservation remain manual checks. |
| `Text.growType` | `fixed`, `auto-width`, or `auto-height`; leaving it untouched does not prevent layout reflow. |
| History | Rechecked 2026-11-17: `undoBlockBegin(): Symbol` starts a block whose operations should undo together; `undoBlockFinish(blockId)` ends that exact block. No rollback method is documented. The adapter starts history only after planning, prevents writes if begin fails, and calls finish in `finally`; finish failures are reported with partial results. Cross-page apply/restore undo and redo remain optional compatibility checks. |
| Permissions | Content write includes read. Explicit content read/write plus `allow:localstorage` support design updates and saved imports; no user/library/network-service permissions are needed. Existing installations need the updated manifest permissions. |

## Primary sources

- [Create a plugin: manifest, messaging, and local loading](https://help.penpot.app/plugins/create-a-plugin/)
- [Penpot interface: UI, current file/page, history](https://doc.plugins.penpot.app/interfaces/Penpot)
- [File interface](https://doc.plugins.penpot.app/interfaces/File)
- [LocalStorage interface and required permission](https://doc.plugins.penpot.app/interfaces/LocalStorage)
- [Page interface](https://doc.plugins.penpot.app/interfaces/Page)
- [Text interface](https://doc.plugins.penpot.app/interfaces/Text)
- [TextRange interface](https://doc.plugins.penpot.app/interfaces/TextRange)
- [HistoryContext interface](https://doc.plugins.penpot.app/interfaces/HistoryContext)
- [Official starter entry point](https://github.com/penpot/penpot-plugin-starter-template/blob/main/src/plugin.ts)
- [Plugin FAQ: hosting and Hub submission](https://help.penpot.app/plugins/faq/)
- [File API: raw Blob bytes](https://w3c.github.io/FileAPI/#dom-blob-arraybuffer)
- [Encoding Standard: fatal UTF-8 decoding and BOM handling](https://encoding.spec.whatwg.org/#interface-textdecoder)

See [project context](PROJECT_CONTEXT.md#planned-mutation-and-recovery-design) for the history/recovery contract and [testing](TESTING.md#optional-penpot-compatibility-checks) for optional host checks. The project does not claim a supported minimum Penpot version.
