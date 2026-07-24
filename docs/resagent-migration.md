# Migrating From OpenCode

ResAgent intentionally preserves OpenCode's internal package boundaries, configuration loader,
provider definitions, session storage, and environment-variable compatibility.

ResAgent is an independent distribution. OpenCode package-manager installations, desktop
applications, release artifacts, and support channels do not install or support ResAgent.

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
- The inherited `opencode.json[c]` filenames and `https://opencode.ai/config.json` schema URL
  remain intentional compatibility details.
- macOS and the inherited desktop application are not ResAgent targets.

## Rollback

ResAgent does not require destructive configuration migration. To roll back, stop ResAgent and
resume the prior OpenCode binary with the backed-up data and configuration. Reports written under
`.resagent/reports` are ordinary Markdown files and can be retained independently.

Review the [quickstart](resagent-quickstart.md) for the first ResAgent run and the
[documentation index](README.md) for the full guide set.
