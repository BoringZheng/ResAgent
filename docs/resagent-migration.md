# Migrating From OpenCode

ResAgent intentionally preserves OpenCode's internal package boundaries, configuration loader,
provider definitions, session storage, and environment-variable compatibility.

## Recommended Process

1. Back up the OpenCode data and configuration directories.
2. Install or build ResAgent without deleting the existing OpenCode installation.
3. Reuse the existing provider configuration.
4. Add a `research` profile and, optionally, `remotes`.
5. Run `resagent doctor` from the intended project directory.
6. Start a new research session before reusing older sessions for production work.

## Compatibility

- Existing provider and model configuration remains valid.
- Existing `OPENCODE_*` environment variables remain supported.
- Existing sessions remain readable through the inherited session engine.
- The `opencode` source command remains available for upstream development workflows.
- Standalone wrappers and release artifacts use the `resagent` command.

## Rollback

ResAgent does not require destructive configuration migration. To roll back, stop ResAgent and
resume the prior OpenCode binary with the backed-up data and configuration. Reports written under
`.resagent/reports` are ordinary Markdown files and can be retained independently.
