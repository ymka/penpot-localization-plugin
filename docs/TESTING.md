# Testing and release validation

## Automated checks

Use Node.js 22+ and Python 3.9+. From the repository root:

```sh
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

Run the Node suite for plugin/UI/message changes, the Python suite for server changes, and both for cross-cutting asset changes. No project dependencies need installation.

| Suite | Boundary and coverage |
| --- | --- |
| [Plugin](../tests/plugin.test.cjs) | Shipped script with mocked Penpot proxies/storage/history/plugin data: manifest/UI wiring, full request validation, context snapshots and stale-page rejection, matching, scope, plan-before-write ordering, repeated keys, idempotence, mixed-style skips, RTL language/script detection, smart alignment, layout reflection/reversal, grid/component skips, metadata failure/conflicts, traversal/setter/history failures, grouped apply/restore, readback, reopening recovery, sanitized logs, request IDs, saved-record limits, per-file storage isolation, and file-switch rejection. |
| [UI](../tests/ui.test.cjs) | Shipped UI script referenced by the HTML and the adapter, with DOM/Penpot/storage/history/plugin-data stubs and real Blob byte reads. Covers script URL resolution at the root and under a static subpath, startup/reopening, pre-read context capture, page/file navigation races, local imports, dynamic languages, invalid/canceled retention, limits/BOM/Unicode, malformed UTF-8 rejection, automatic/manual apply, direction switching, page direction persistence and reporting, durable style recovery, session text recovery, operation locks, source/text rendering, per-file save/forget, transport/storage failures, result validation, and stale/foreign/malformed replies. |
| [Server](../tests/test_server.py) | Actual handler with in-memory HTTP connections: allowed assets, private/traversal/symlink rejection, query strings, HEAD, preflight, and headers. |

GitHub Actions runs both commands on `ubuntu-latest` with Node.js 22 and Python 3.14, without installing project dependencies. The [test workflow](../.github/workflows/tests.yml) runs when a pull request is opened or receives new commits, and on pushes to `main`, including pull request merges. The local development server supports Python 3.9 and later. These tests do not establish browser policy, Penpot layout/style/font behavior, or undo/restore correctness.

## Optional Penpot compatibility checks

These checks can help investigate a reported problem or document compatibility with a particular environment. They are not release gates. Use a disposable file with at least two pages. **Pending** means only that an optional observation is not individually documented, not that a test failed or the plugin is incomplete. The successful general functional result is recorded [below](#validation-record).

| Scenario | Required observation | Status |
| --- | --- | --- |
| Local install/restart | Updated manifest, script, and UI load from localhost; grant local-storage permission; startup uses only this design file's saved copy, if present | Pending |
| Static HTTPS subpath | Relative assets work under a repository-style path | Pending |
| Tagged/untagged layers | Exact-prefix text only; repeated keys and nested boards/groups work | Pending |
| Page/file scopes | Each launch defaults to the current page, including saved imports; page mode isolates it; explicitly choosing file mode reaches non-active pages | Pending |
| Missing/empty values | Missing keys preserve current text and warn; empty strings clear text | Pending |
| Languages | English names for EN/ES/FR/ZH, Arabic, Portuguese, Hindi, lowercase and regional/script codes appear correctly; custom codes remain literal; Unicode translations render correctly | Pending |
| RTL text/layout | Switch to either direction with or without translations, verify untagged and tagged text direction/alignment, unchanged strings, fixed top-level boards, plain/flex mirroring, grid/component layout skips, mixed and unknown choices, partial results, navigation, reopen and Restore. Check recognized RTL language styling on pages without a chosen direction. | Pending: mocked coverage added; real direction/layout/plugin-data behavior unverified |
| Automatic/manual application | Language changes and valid reimports with the selected language apply once to the chosen scope; first imports and missing-language/rejected/canceled imports do not; prominent apply action stays visible after success and can translate newly added tagged text without reimporting or changing language | Pending |
| Invalid/oversized imports | Reject malformed UTF-8, invalid JSON and oversized files without writes, retain last valid dictionary, render payload as text | Pending |
| Styles | Supported font/size/color/alignment retained; unsupported mixed styles skipped | Pending: automated skip coverage added; real-host preservation/detection unverified |
| Grow settings/long strings | Fixed/auto-width/auto-height retained; inspect clipping, wrapping, and parent reflow | Pending |
| CJK/missing fonts | Inspect glyph coverage and fallback; warnings match limitations | Pending |
| Locked layers/components | No unexpected component changes; failed/skipped counts accurate | Pending |
| Undo/redo | Apply and Restore create one undo/redo step per edited page and return to the starting page in file scope | Pending: grouped implementation and mocked close-on-failure coverage added; real history unverified |
| Restore/conflicts | Handle edits made outside the plugin, layers deleted outside the plugin before Restore, file switches, repeated switches, and external undo safely; Restore must not delete or recreate layers | Pending: session restore/conflict/externally deleted-layer/rebase behavior covered with mocks; real host unverified |
| Rapid input/messages | Only one UI context/mutation request pending; conflicting controls locked; matching results restore them; foreign/stale replies ignored and malformed matches reported; active-page changes during reads cannot retarget page-scoped automatic apply | Pending: mocked context/apply/restore coverage added; real host unverified |
| Keyboard/narrow window | Apply/restore controls, status, focus, and warnings remain usable | Pending |
| Close/reopen and saved imports | Same design file restores its saved JSON/language without writes but not its recovery journal; another file has independent saved data; original-file edits require reimport; Forget clears only the saved import; storage denial/quota errors leave session imports usable | Pending: mocked saved-import/recovery-lifetime coverage added; real host unverified |

Record each run's date, revision, `penpot.version`, browser/OS versions, sanitized fixture, observations, and unresolved issues. Keep private design text and dictionaries out of fixtures and screenshots.

## Validation record

### Plugin runtime directory — 2026-11-26

Moved the four runtime files into `plugin/`. Both JavaScript syntax checks, all 116 mocked plugin/UI tests, all four in-memory HTTP tests, and `git diff --check` passed. The HTTP tests compare all four original asset URLs against the relocated files and verify that the development server rejects `/plugin/` and `/plugin/manifest.json`. The UI wiring test checks relative script URLs at the root and under a repository-style subpath. Live Penpot and deployed HTTPS hosting were not exercised.

### External UI script — 2026-11-26

Moved the UI script into `ui.js`. Compared it with the former inline script after normalizing indentation and verified that the HTML and CSS match apart from the script reference.

`node --check ui.js`, `node --test tests/*.test.cjs` (116 tests), the Python unittest suite (four in-memory HTTP tests), and `git diff --check` passed. The UI tests execute the script referenced by the HTML and verify its URL under both root and repository-style paths. The HTTP suite checks that the server returns the shipped script contents. Live browser and Penpot loading, deployed HTTPS hosting, and remote CI were not exercised.

### Single direction switch control — 2026-11-26

All 115 mocked plugin/UI tests and `git diff --check` passed. The UI tests verify the reverse action for a known direction, an explicit target for mixed or unknown scopes, scope reset, busy controls, retained focus, and a preselected retry after a partial switch. Live browser and Penpot checks were not run.

### PR #4 review fixes — 2026-11-26

The shipped adapter and UI were checked with 115 mocked plugin/UI tests. Added coverage enforces active-page writes, covers failed activation and file navigation races, and verifies one history block per edited page. Recovery cases assert no irreversible writes for unset directions or silently rejected recovery metadata, per-page Restore after a conflict, retry and reversal after partial conversion, nested reflection and group reflow, and continued recovery from historical absolute position records. The UI exercises retry after a partial switch.

`node --check plugin.js`, `node --test tests/*.test.cjs`, `python3 -m unittest discover -s tests -p 'test_*.py' -v` (four in-memory HTTP checks), and `git diff --check` passed. Penpot 2.19.3 source was checked for active-page setters and workspace transactions. Live Penpot navigation, layout, metadata persistence, undo/redo and remote CI were not exercised.

### LTR/RTL direction switching — 2026-11-26

`node --check plugin.js`, `node --test tests/*.test.cjs` (105 mocked plugin/UI tests), `python3 -m unittest discover -s tests -p 'test_*.py' -v` (four in-memory HTTP checks), and `git diff --check` passed. The regression tests exercise both shipped endpoints and verify observable text direction, alignment, position, constraint, and recovery writes. They cover conversion without a dictionary, initially RTL pages, mixed and unknown scopes, untagged text, preservation of translated strings, page navigation and request rejection, reopening, rejected page metadata, partial layout confirmation, and Restore.

Live Penpot rendering, page plugin-data persistence, event delivery, history and non-active page behavior, and remote CI are unverified for this change.

### GitHub Actions triggers — 2026-11-26

GitHub recorded successful runs when PR #1 [opened](https://github.com/ymka/penpot-localization-plugin/actions/runs/45815169398), [received a new commit](https://github.com/ymka/penpot-localization-plugin/actions/runs/45815567782), and [merged](https://github.com/ymka/penpot-localization-plugin/actions/runs/45816561763). The merge run checked out `33284de` from `main` under the previous `pull_request: closed` trigger. The local workflow revision uses the documented [branch-filtered push trigger](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#running-your-workflow-only-when-a-push-to-specific-branches-occurs) for updates to `main`. Remote validation of that revision is pending.

### GitHub Actions runner compatibility — 2026-11-26

The reported GitHub Actions run failed during Python 3.9 setup on Ubuntu 26.04. The workflow selects Python 3.14 on `ubuntu-latest`, matching the Python series available locally and in GitHub's Ubuntu 26.04 tool cache. On a local snapshot of the `main` base, all 79 mocked plugin/UI tests passed on Node.js 26.10.0 and all four in-memory HTTP tests passed on Python 3.14.7. [GitHub Ubuntu 26.04 runner image](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2604-Readme.md#python)

### Unchecked English layout target after pending baseline — 2026-11-19

Fixed a user-reported sequence where English was selected, **Mirror RTL layout** was applied, then unchecking and applying again left the checkbox checked. The adapter treated every non-baseline layout metadata marker—including `pending-baseline` after the layout properties had returned to baseline but final metadata confirmation failed—as confirmed mirrored state. Pending layout transitions now make the returned layout state incomplete and only a confirmed `rtl` marker reports mirrored layout, so the result cannot re-check the user's unchecked manual target.

The end-to-end mocked UI/adapter regression injects a sanitized failure in the final baseline metadata write after observable position and constraint restoration. Before the fix it failed with `true !== false` for the checkbox; afterward it preserves the unchecked target and displays the metadata warning. A plugin regression also verifies that partial managed layout writes report incomplete layout state. The official `Page.findShapes` contract was rechecked and still documents optional criteria, ruling out the all-shapes recovery scan as the cause. `node --check plugin.js`, `node --test tests/*.test.cjs` (97 tests), and `git diff --check` passed. No real-browser/Penpot or remote CI run was performed; the Python server suite was not rerun because no server or runtime-asset wiring changed.

### Language-independent manual layout mirroring — 2026-11-19

Fixed a user-reported manual Apply failure when English was selected and **Mirror RTL layout** was checked. The UI already sent the checked manual layout request, but the adapter incorrectly combined that request with recognized-RTL language detection and planned the baseline for English. Manual layout planning now follows the submitted checkbox independently; RTL detection continues to control text direction and alignment only. Added an end-to-end mocked UI/adapter regression for English selection, checked mirroring, observable geometry and constraint writes, and confirmed checkbox state.

The focused regression failed before the fix with `20 !== 150` for the child position and passed afterward. `node --check plugin.js`, `node --test tests/*.test.cjs` (97 tests), and `git diff --check` passed. No real-browser/Penpot or remote CI run was performed; the Python server suite was not rerun because no server or runtime-asset wiring changed.

### Code-review recovery fixes — 2026-11-18

Resolved the remaining recovery review findings. Recovery-status requests now supersede an older pending scope so a stale reply cannot leave Restore availability stuck. Apply counts page traversal failures while returning mirrored layout to its baseline, including LTR application and RTL application with mirroring off. Restore now returns a validated per-page traversal-failure count, keeps traversal failures available for retry, and displays them as blocking errors without concealing successful text/style/layout writes. Unreadable shape metadata during Restore has a dedicated count and warning instead of inflating generic failures. Page-failure accounting is deduplicated when more than one traversal path fails on the same page.

`node --check plugin.js` passed; `node --test tests/*.test.cjs` passed all 95 mocked plugin/UI tests; `python3 -m unittest discover -s tests -p 'test_*.py' -v` passed all four in-memory HTTP tests; and `git diff --check` passed. New coverage exercises superseded recovery-status replies, LTR/baseline layout scan failures, Restore traversal reporting and retry availability, successful text recovery alongside a failed metadata scan, and warning-only unreadable metadata. No real-browser/Penpot or remote CI run was performed.

### Automatic RTL layout state — 2026-11-18

Changed **Mirror RTL layout** from a per-design saved preference and later one-shot request into a session-only display and manual control of confirmed mirrored state. Legacy saved values are ignored. Automatic RTL/LTR language and retained-language reimport application explicitly preserve layout; only manual Apply submits whether layout should mirror or return to baseline. Apply, Restore, and recovery-status results carry durable mirrored state so the checkbox follows actual managed metadata, including after reopening, while blocking failures retain the last confirmed state and an exact retry. If no supported layout was mirrored, the checkbox remains off. Removed the unused RTL-preference message/storage path.

`node --check plugin.js` passed; `node --test tests/*.test.cjs` passed all 96 mocked plugin/UI tests; `python3 -m unittest discover -s tests -p 'test_*.py' -v` passed all four in-memory HTTP tests; and `git diff --check` passed. Coverage verifies that automatic RTL/LTR changes and reimports preserve both baseline and mirrored layouts, manual checked Apply mirrors, manual unchecked Apply restores, pending checkbox choices survive automatic text application, durable mirrored state is rediscovered after reopening, Restore updates state, and legacy preferences remain ignored. No real-browser/Penpot or remote CI run was performed.

### RTL host-compatibility hardening — 2026-11-18

A user report from Penpot 2.19.3-RC1 showed repeated generic diagnostics during Apply/startup: 61 layout-update failures, 43 recovery-metadata inspection failures, and 16 text-layer inspection failures. The report also showed that text matching continued (20 strings already matched across 22 tagged layers) while two layers could not be updated. The fixture/design contents, browser/OS, and exact rejected properties were not captured, so this is real-host failure evidence rather than a complete compatibility characterization. The report-only localhost iframe CSP warning did not block loading and is recorded as unrelated to the mutation failures.

The adapter now omits absent/invalid optional layout values before metadata or property writes, validates nonnegative flex padding, isolates each managed property setter/readback so one host rejection does not block supported properties on the same shape, and aggregates expected property failures into one diagnostic per operation kind. Invalid or unreadable shape metadata no longer blocks eligible text replacement or emits repeated recovery-inspection diagnostics; because its baseline cannot be proven, it remains untouched and is reported separately from external conflicts. Apply/Restore results now distinguish component/grid subtree skips, unsupported targets, unreadable metadata, external conflicts, managed property failures, and other failures. Layout failures use a validated fixed-key breakdown for alignment, constraints, flex direction, margins, metadata, padding, position, and target access/readback, without exposing shape identifiers, design values, or raw host errors. Expected partial-layout and conflict results use warning styling and retain the normal Apply label; only unexpected failures enter red retry state. Regression coverage uses Penpot-like optional flex values, a single throwing layout setter with successful sibling setters, malformed plugin data across Apply/recovery-status/Restore, validated detailed UI rendering, warning severity, and retry-label behavior.

`node --check plugin.js` passed; `node --test tests/*.test.cjs` passed all 93 mocked plugin/UI tests; `python3 -m unittest discover -s tests -p 'test_*.py' -v` passed all four in-memory HTTP tests; and `git diff --check` passed. No browser, post-fix real-Penpot, or remote CI run was performed. The user-reported environment therefore still needs a compatibility retest to identify any remaining rejected properties.

### RTL text and opt-in layout mirroring — 2026-11-17

Added case-insensitive RTL detection for the documented base and script codes without changing the translation JSON contract. Matching uniform text now receives RTL direction and smart physical alignment; LTR application restores recorded baselines. Added a per-design, default-off layout option that keeps top-level boards fixed while mirroring supported plain/absolute geometry, horizontal constraints, asymmetric flex padding/margins, row direction, and column-flex horizontal alignment. Component/grid layout subtrees and visual artwork are left unchanged and reported.

Style/layout baselines and last-written state are stored as versioned, text-free shape plugin data with metadata-first writes; the existing recovery journal remains session-only and text-only. Reapplication is idempotent, baseline-state changes can be adopted, active RTL divergence is reported without overwrite, and Restore can discover durable RTL state after reopening. The adapter protocol now validates the layout option, expanded apply/restore counts, a separate per-file preference exchange, and correlated recovery-status checks.

`node --test tests/*.test.cjs` passed all 90 mocked plugin/UI tests; `python3 -m unittest discover -s tests -p 'test_*.py' -v` passed all four in-memory HTTP tests; `git diff --check` and `node --check plugin.js` passed. New coverage executes the shipped adapter/UI and asserts RTL base/script detection, unchanged translation payloads, smart alignment, mixed-style safety, LTR and checkbox reversal, idempotence, fixed top-level boards, nested plain/flex geometry, spacing/constraints, no visual flipping, component/grid skips, metadata-first failure and partial-retry safety, external conflicts, per-file preference isolation, recovery-status correlation, reopening, and style/layout Restore without persistent text.

Real Penpot direction/alignment setters, nested coordinate behavior, flex/layout-child setters, plugin-data persistence/collaboration/history behavior, grouped cross-page undo/redo, and visual layout remain unverified. The unchanged server was nevertheless rerun because the final validation command covered both documented suites; no real browser, Penpot instance, or remote CI run was performed.

### Pre-read page context safeguard — 2026-11-17

Added a correlated `design-context-request`/`design-context-result` exchange before `File.arrayBuffer()`. The adapter returns only validated current file/page IDs. Retained-language automatic apply carries the captured page ID: page scope rejects a changed active page before planning or history, while file scope remains valid across active-page navigation because its target is unchanged. Context send failures and matching malformed replies stop the import before reading; foreign and stale replies do not release controls. First imports without a selected language still capture context but remain non-mutating, and a failed startup storage request still permits session import without treating the context snapshot as the persisted design-file identity.

`node --test tests/*.test.cjs` passed all 79 mocked plugin/UI tests; `python3 -m unittest discover -s tests -p 'test_*.py' -v` passed all four in-memory HTTP tests; `git diff --check` passed. New coverage asserts snapshot IDs and validation, no writes/history for stale page scope, file-scope navigation behavior, context-before-read ordering, file/page switches during deferred reads, transport failure, malformed/stale/foreign replies, and control restoration. Real Penpot navigation during browser file reads, browser picker timing, and remote CI remain unverified.

### Session recovery and grouped history — 2026-11-17

Refactored mutation handling to validate the complete dictionary request, capture file/page/scope identity, finish traversal, and build plain-data operations before any setter call. Each mutating apply/restore starts one Penpot history block and closes it in `finally`; history-start failures prevent writes, and history-finish failures preserve partial counts and display a warning. Exact text readback gates successful counts. Page traversal errors no longer conceal safe-page results.

Added a runtime-only recovery journal keyed by file/page/shape ID with original and last-plugin-written text. Repeated uninterrupted language switches preserve the first original; an explicit apply after divergent text rebases the baseline. Restore uses the selected page/file scope, resolves current targets by ID, consumes successful entries, and leaves external edits, undo/redo divergence, layers deleted outside the plugin before Restore or otherwise missing, mixed styles, and failures unchanged with explicit counts. Restore does not delete or recreate layers. The UI exposes an always-present restore action, explains session lifetime, shares the apply operation lock, validates correlated restore results, and clears recovery availability when the plugin runtime closes. Forgetting a saved import remains separate from design recovery.

`node --test tests/*.test.cjs` passed all 74 mocked plugin/UI tests; `python3 -m unittest discover -s tests -p 'test_*.py' -v` passed all four in-memory HTTP tests; `git diff --check` passed. Coverage executes shipped scripts and asserts plan-before-write ordering, observable setters and absence of rejected writes, readback mismatch recovery, history begin/finish behavior for apply and restore, repeated switches, rebasing, conflicts, layers deleted outside the plugin, file switches, page/file scope, session clearing, operation locks, stale/foreign/malformed replies, sanitized failures, and status text. Real Penpot apply/restore undo and redo, cross-page grouping, history API failures, lookup of a layer deleted outside the plugin before Restore, setter readback, styles/layout, keyboard/visual behavior, and remote CI remain unverified.

### Mixed-style text safety — 2026-11-16

Changed whole-text application to inspect every documented mixed-capable aggregate text-style property before mutation. A changed layer reporting `"mixed"` is skipped without a setter call; already-correct mixed text needs no style inspection or write. Style-inspection failures are counted as failed layers and also receive no write. Successful results now include a validated `skipped` count, and the UI explains that mixed-style layers were skipped to preserve formatting without presenting the condition as retryable. The README and inline help describe rich-text translation as unsupported. The relevant official Penpot `Text` and `TextRange` sources were rechecked and recorded in [API review](API_REVIEW.md).

`node --test tests/*.test.cjs` passed all 61 mocked plugin/UI tests; `git diff --check` passed. Regression coverage checks each mixed-capable property, absence of writes for skipped and inspection-failure layers, continued uniform-layer updates, the already-correct path, result validation, and visible skip reporting. Real Penpot mixed-style detection, uniform font/size/color/alignment and geometry preservation, browser rendering, and remote CI were not verified. The unchanged Python server suite was not rerun.

### English language names — 2026-11-16

Changed all built-in language names to English, including Arabic, Portuguese, Hindi, Spanish, French, and Chinese. Updated the README and existing label regression expectations. Original codes, case/regional/script handling, custom-code fallback, translation contents, and saved selections retain their behavior.

`node --test tests/*.test.cjs` passed all 57 mocked plugin/UI tests; `git diff --check` passed. Real Penpot/browser rendering and remote CI were not verified. The unchanged Python server suite was not rerun.

### Expanded language labels — 2026-11-16

Expanded the dropdown's built-in native-name mapping to include Arabic, Portuguese, Hindi, and other common languages. Label lookup recognizes case variants and the base language of regional/script codes while retaining each exact imported code in the label, option value, apply request, and saved selection. Unknown codes remain literal. Only imported languages appear; no runtime assets, dependencies, host API, or protocol changed.

`node --test tests/*.test.cjs` passed all 57 mocked plugin/UI tests; `git diff --check` passed. New regression coverage exercises shipped UI/adapter code, checks native labels, existing labels, lowercase/regional/script variants, unknown and prototype-like codes, distinct `AR`/`ar` selection with observable setters, and saved-copy restoration without extra writes. Real Penpot/browser rendering, including right-to-left label display, and remote CI were not verified. The unchanged Python server suite was not rerun.

### Code-review fixes — 2026-11-16

Addressed all three review findings: adapter failure logs now contain generic messages without imported keys or raw host exceptions; storage send failures clear pending state and release startup/forget locks without blocking language-change or valid-reimport application; imports read raw bytes and reject malformed UTF-8 before replacing active/saved data or applying. A startup send failure still requires reopening to capture the design-file ID before applying. No API payload, permission, runtime asset, dependency, or hosting change was needed. Official Penpot messaging and browser file/decoding sources were rechecked in [API review](API_REVIEW.md).

The five new regression tests failed against the previous runtime code. After the fixes, `node --test tests/*.test.cjs` passed all 56 tests. Coverage uses shipped scripts with mocked DOM/Penpot/storage/transport boundaries and real Blob byte reads: malformed sequences cause no additional setters or saves; explicit Unicode/replacement characters and BOM remain valid; failed saves permit automatic application; failed forgetting retains the import and can be retried; startup failure releases controls without allowing writes with an unknown file identity; failure logs omit sanitized fixture contents and raw errors. Existing failed-read and file-switch race tests now exercise `arrayBuffer()`.

`python3 -m unittest discover -s tests -p 'test_*.py' -v` passed all four in-memory HTTP tests; `git diff --check` passed. Real browser/Penpot import, storage-transport recovery, visual/keyboard behavior, and remote CI were not verified in that run.

### Dropdown arrow alignment — 2026-11-16

The user's screenshot showed the native arrows against the right borders of both dropdowns. Both native selects now use decorative inline SVG chevrons centered vertically in relative wrappers, inset 12 px from the right, with 40 px reserved text padding. The icons use the current text color, ignore pointer input, and dim alongside disabled selects; labels, native select behavior, and focus styling are retained. No runtime assets or dependencies were added.

`node --test tests/*.test.cjs` passed all 51 mocked plugin/UI tests; `git diff --check` passed. These checks do not verify CSS rendering. Post-fix browser/Penpot visual, keyboard, light/dark, and narrow-window checks and remote CI remain pending. The unchanged Python server suite was not rerun.

### Disabled language placeholder — 2026-11-16

**Choose a language** is now a disabled placeholder in the initial HTML and dynamically generated options, including after imports and forgetting. Actual language options remain selectable. `node --test tests/*.test.cjs` passed all 51 mocked plugin/UI tests; regression coverage checks placeholder/real-option states, selected-language retention, missing-language reimports, and reset without extra apply messages. `git diff --check` passed. Native mouse/keyboard dropdown behavior in Penpot and remote CI were not verified; the unchanged Python server suite was not rerun.

### Always-visible apply button — 2026-11-16

The prominent apply button now stays visible, including after reopening, successful updates, and forgetting. Its scope label is **Apply to current page** / **Apply to all pages**, with **Applying…** during updates and **Try again** after failures. It is disabled without a language/dictionary/file or while busy. Removed last-success visibility tracking; explicit reapplication can translate newly added tagged text using the loaded dictionary. Focus returns to the same button after a button-initiated update.

`node --test tests/*.test.cjs` passed all 50 mocked plugin/UI tests. Updated coverage checks visibility/disabled states, correct scope labels, same-language application to a newly added layer without reimporting, non-mutating scope changes, reopening, forgetting, partial failures/retry, and retained focus. `git diff --check` passed. Real Penpot/browser visual and keyboard verification and remote CI remain pending. No host API or protocol changed; the unchanged Python server suite was not rerun.

### Conditional apply button — 2026-11-16

The apply button now appears only for saved selections not applied in this session, a changed scope, or retries. Labels identify the action: **Apply selected language**, **Apply to current page**, **Apply to all pages**, or **Try again**. Successful language changes, reimports, and button applies hide it; returning to the last successful scope hides it without writes. Partial layer failures retain a retry action. Keyboard focus returns to Language after a focused button disappears, or to retry after failure.

`node --test tests/*.test.cjs` passed all 50 mocked plugin/UI tests; `git diff --check` passed. Coverage verifies initial/first-import hiding, saved-selection labels, non-mutating scope changes, scope reversal, hidden-button guards, automatic-reimport completion, forget/reset, partial failures and retry, and focus after success/failure. Real-browser/Penpot visibility, focus, light/dark styling, narrow-window verification, and remote CI remain pending; automated tests use DOM/Penpot/storage stubs. No host API or message protocol changed for this follow-up. The unchanged Python server suite was not rerun.

### Automatic language changes and reimport application — 2026-11-16

Language changes now apply immediately. Successful explicit imports automatically reapply a retained selected language using the new dictionary and chosen scope, after read/validation cleanup. First imports without a language, rejected/canceled imports, imports missing the selected language, startup, scope changes, and forgetting cause no automatic writes. **Apply again** remains for preselected languages and scope changes. The UI locks conflicting controls with one apply pending, correlates numeric request IDs, validates matching success payloads, and releases controls on errors/malformed results in `finally`. Official messaging sources were rechecked; the protocol fields are plugin-defined plain data and add no API permissions.

`node --test tests/*.test.cjs` passed all 46 tests. The tests execute both shipped endpoints and count observable setter calls, covering one automatic apply per language/reimport action, fresh strings and chosen scope, no writes for rejected/canceled/missing-language imports or saved-copy restoration, busy controls, stale/foreign/malformed replies, adapter/send failures with retry, and file switches during a pending read. `git diff --check` passed. The unchanged Python server suite was not rerun for this UI/protocol change.

Tests use mocked DOM/Penpot/storage boundaries; real Penpot automatic application, browser controls/picker behavior, layout/fonts/styles, and remote CI remain unverified for this change. Page-context capture during asynchronous reads and full apply-envelope validation remain planned; file identity is checked before writes.

### Current-page default — 2026-11-16

**Apply to** now defaults to **Current page only** on every launch, including when restoring a saved dictionary/language. All-pages scope remains an explicit choice. The UI stub reads the selected scope from the shipped HTML. Regression coverage executes both shipped endpoints, checks that default Apply changes only the current page, verifies that changing scope alone performs no writes, and confirms explicit file-wide Apply and the current-page default on reopening.

`node --test tests/*.test.cjs` passed all 37 mocked plugin/UI tests; `git diff --check` passed. Real Penpot verification and remote CI were not performed. The unchanged Python server tests were not rerun for this UI default change.

### Saved-source filename display — 2026-11-16

The user reported that reopening used the saved translations but showed “No file chosen.” This is a real-host report of saved-copy reuse and a misleading picker display; environment/revision details and other persistence scenarios were not supplied. The native picker has no selection after reopening, independently of the active saved dictionary. The UI now shows **Source** as the primary filename display and a labeled **Choose JSON file…** / **Replace or reload JSON…** button that opens a hidden native file input. The input is cleared before opening to permit same-file reimports; canceling or rejecting a replacement retains the active source.

The focused regression command, `node --test --test-name-pattern='saved copy shows its filename' tests/ui.test.cjs`, failed before the fix because the empty native picker was visible and passed afterward. `node --test tests/*.test.cjs` passed all 36 tests; `git diff --check` passed. Coverage includes picker activation, loading guards, cancellation, invalid/valid replacements, same-file reselection, forgetting, and absence of design messages during those actions. Real-browser/Penpot visual, keyboard, and picker-opening checks for this UI change remain pending; the tests use DOM/Penpot/storage stubs. The unchanged Python server tests were not rerun for this display-only follow-up.

### Saved imports and language per design file — 2026-11-16

Added browser-local saved copies and language selection keyed by Penpot design-file ID, explicit **Apply language**, and **Forget saved file**. The native picker remains empty on restoration; **Source** identifies the saved copy. File identity is checked before storage changes and design application. The manifest now requests `allow:localstorage`; the relevant official file, storage, manifest, and messaging sources were rechecked and recorded in [API review](API_REVIEW.md).

`node --test tests/*.test.cjs` passed all 35 tests using mocked DOM/Penpot/storage boundaries. The UI tests execute both shipped endpoints together and cover reopening with a selected language, independent design files, edited-file reimports, literal prototype keys/filenames rendered as text, invalid input retaining storage, forget/restart isolation, storage exceptions, malformed/foreign/stale replies, loading controls, and rejection after a file switch. Setter counters verify that only explicit Apply writes text and rejected file identities write nothing. Adapter tests cover storage validation and UTF-8/entry limits before saving, corrupt records, missing storage, and per-file deletion without design writes.

`python3 -m unittest discover -s tests -p 'test_*.py' -v` passed all four in-memory HTTP handler tests. `git diff --check` passed. Real-browser/Penpot persistence, updated manifest permission handling, quota behavior, narrow-window/keyboard layout, and remote CI remain unverified for this change. Mocked storage is not evidence of host/browser persistence or synchronization.

### File picker filename regression — 2026-11-16

The UI cleared the native file input after every import, so a successful import left the picker showing “no file chosen” while **Source** still named the loaded dictionary. Successful imports now retain the selection; failures clear it to allow retrying the same file, and loading controls are still restored in `finally`.

`node --test tests/*.test.cjs` passed all 21 mocked plugin/UI tests. The new filename regression failed before the fix and passed afterward. The file-input stub now starts with a selected filename and clears its file list when its value is reset. Coverage also checks edited-file reimports, cancellation, failed-read retries, and absence of design messages during imports. No real-browser/Penpot verification or remote CI was performed for this fix; native picker behavior remains a manual check.

### User functional test — report received 2026-11-15

**Passed: functional use in Penpot.** In the development conversation, the user stated: “I tested plugin it works as expected.” On 2026-11-17, the user also reported changing languages several times and successfully restoring the original text during the same session. No issues were reported.

The revision, installation method, specific languages, page scope, Penpot/browser/OS versions, fixture, and screenshots were not supplied. This is real-host functional evidence, separate from automated tests. Broader environment compatibility has not been claimed.
