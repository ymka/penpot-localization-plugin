# Contributing

Read [project context](docs/PROJECT_CONTEXT.md) before making changes and follow the [coding standards](AGENTS.md#implementation-standards). Use [the release plan](docs/V0_1_0_PLAN.md) to select unfinished work.

Keep changes focused and dependency-light. Run [the relevant tests](docs/TESTING.md), add regression coverage for behavioral fixes, and describe which checks used mocks and which ran inside Penpot. Update documentation when behavior or decisions change.

For bug reports, include the plugin revision, Penpot/browser versions, scope, expected result, and a minimal sanitized fixture. Use disposable designs while testing. Keep private dictionaries, credentials, and design content out of commits and reports.

For a suspected vulnerability, avoid posting sensitive details in a public issue. Use GitHub private vulnerability reporting if the owner has enabled it; otherwise request a private contact without disclosing exploit details publicly.

For license decisions and publication approval, see [README](README.md#license-and-publication).
