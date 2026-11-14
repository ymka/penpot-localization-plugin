# Working on Penpot Localization

## Before editing

Read [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) before changing code. It owns architecture and design decisions; [README.md](README.md) owns user behavior and the translation JSON contract. Keep implemented behavior distinct from planned safeguards.

- Read affected code and tests, and preserve unrelated working-tree changes.
- For API, manifest, messaging, permissions, history, or hosting changes, read [docs/API_REVIEW.md](docs/API_REVIEW.md) and recheck its relevant official sources. Record new API assumptions there; record runtime observations in the testing record.
- For mutation or restore work, follow [the planned design](docs/PROJECT_CONTEXT.md#planned-mutation-and-recovery-design). For release work, use [docs/V0_1_0_PLAN.md](docs/V0_1_0_PLAN.md).
- Before validation, read [docs/TESTING.md](docs/TESTING.md) for commands, test boundaries, and optional Penpot compatibility checks relevant to the change.

## Implementation standards

- Keep the plain JavaScript/HTML plugin usable without a build step. Python is a local development server, not a plugin backend. Add dependencies or new infrastructure only for a demonstrated need and document the reason.
- Keep Penpot API access behind the plugin adapter, DOM/file input in the UI, and messages as plain data. Prefer pure validation/planning functions when extracting logic; keep host proxies out of messages and restore journals.
- When adding runtime files, update asset references, the server allowlist, wiring tests, and hosting instructions together. Verify relative loading under a static subpath. Limit manifest permissions to required capabilities.
- Follow surrounding JavaScript style: two spaces, semicolons, `const` by default, descriptive `camelCase` names, and strict comparisons. Node APIs belong in tests/tooling.
- Validate each trust boundary before mutation; UI checks do not replace plugin-side checks. Follow the README's input limits. Use own-property lookups and treat `__proto__` and `toString` as literal data; avoid merging imported objects into configuration or prototypes.
- Render imported content, filenames, keys, and errors through text APIs. Keep data out of HTML execution sinks and `eval`.
- Validate message source, type, and payload. Update both endpoints and regression tests when changing the protocol. Follow the origin guidance in the API review rather than inferring the parent origin from the asset host.
- Preserve native labeled controls, keyboard access, visible focus, readable light/dark colors, live status, and usable narrow-window layouts. Restore busy state in `finally`, including error paths.

## Python server standards

- Follow [PEP 8](https://peps.python.org/pep-0008/): four-space indentation, grouped imports, `snake_case` functions/variables, `PascalCase` classes, and uppercase constants. Use type hints and docstrings where they clarify contracts; avoid unrelated formatting churn.
- Use standard-library tooling and APIs compatible with the documented minimum Python version. Update README, testing instructions, and CI together when changing supported versions.
- Keep imports free of server startup, startup behind the main guard, paths independent of the shell directory, and cleanup explicit through context managers. Catch expected errors at useful boundaries while preserving unexpected failures for diagnosis.
- Preserve loopback binding, explicit public-asset serving, symlink refusal, and denial of private paths and listings. CORS is not access control. Keep request state local because the server is threaded; this server is for development only.

## Completion

- Run relevant checks from `docs/TESTING.md` after code changes. Add regression coverage for translation selection, scope, message, and restore fixes; assert observable writes and absence of writes on rejected input, including relevant failures and races.
- Exercise shipped code and mock external boundaries. Keep stubs faithful, including HTML defaults; mocked setters cannot prove Penpot styling, layout, fonts, or recovery.
- Update the document that owns the changed behavior: README for usage/JSON, project context for requirements/architecture, release plan for open work, and testing record for evidence. Keep contribution guidance consistent.
- Report changes, checks actually run, and remaining limitations. Distinguish mocked tests, in-memory HTTP checks, real Penpot results, and remote CI; leave unperformed validation explicit.
- Keep private design text, dictionaries, credentials, and identifying screenshots out of commits, fixtures, logs, and reports. Use sanitized examples.
- Preserve prototype status until the release package is complete and the owner approves publication. Follow [the license decision](README.md#license-and-publication) before applying a license.
- Publish, push, deploy, or submit to the Plugin Hub only with the user's explicit approval. Local preparation does not authorize those actions.
