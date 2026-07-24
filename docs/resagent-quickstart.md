# ResAgent Quickstart

This guide starts with an installed or source-ready ResAgent and ends with a completed Markdown
research report. ResAgent supports Windows x64 and Linux x64. macOS is not supported.

For native archive download, checksum verification, source checkout, and build instructions,
complete the [installation guide](resagent-installation.md) first. Return to the
[documentation index](README.md) for reference, security, development, and release guides.

## 1. Choose An Investigation Directory

Create or open the directory that should own the configuration, sessions, and reports:

```powershell
New-Item -ItemType Directory -Path .\my-investigation -Force | Out-Null
Set-Location .\my-investigation
```

Linux:

```bash
mkdir -p ./my-investigation
cd ./my-investigation
```

Every command in the rest of this guide runs from this directory.

Native installations use `resagent`. In source mode, save the absolute entrypoint and replace
each `resagent ...` command with `bun run $resagent ...` on PowerShell:

```powershell
$resagent = "C:\path\to\ResAgent\packages\opencode\src\index.ts"
$env:RESAGENT_LAUNCH = "1"
bun run $resagent --version
```

Linux source mode:

```bash
resagent_source="/path/to/ResAgent/packages/opencode/src/index.ts"
export RESAGENT_LAUNCH=1
bun run "$resagent_source" --version
```

Do not run `node bin/resagent` from a source checkout. The package launcher expects an installed
binary layout.

## 2. Connect A Provider

Use the CLI:

```powershell
resagent auth login
resagent auth list
resagent models
```

Or start the TUI with `resagent`, enter `/connect`, choose a provider, and complete its API-key or
OAuth flow.

`resagent models` prints the exact `provider/model` identifiers accepted by research profiles.
Do not guess identifiers from provider marketing names.

## 3. Create A Research Profile

Create `opencode.jsonc` in the investigation directory. The inherited filename and schema URL are
intentional compatibility details.

Replace every example route entry with an exact identifier from `resagent models`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "research": {
    "default_profile": "balanced",
    "profiles": {
      "balanced": {
        "planner": ["provider/model-planner"],
        "collector": ["provider/model-fast"],
        "analyst": ["provider/model-analysis"],
        "verifier": ["provider/model-verifier"],
        "writer": ["provider/model-writer"],
      },
    },
  },
}
```

Every role needs at least one available model. Additional entries form an ordered fallback route:

```jsonc
"analyst": ["provider-a/model-a", "provider-b/model-b"]
```

Fallback occurs only for classified retryable failures before assistant output or tool side
effects. Authentication, policy, invalid-request, and context-loss failures stop instead of
routing around the error.

## 4. Run The Preflight Check

```powershell
resagent doctor
```

A local-only setup is ready when these checks are `ok`:

```text
providers
research profile
route planner
route collector
route analyst
route verifier
route writer
OpenSSH
report directory
```

`remote hosts: none configured` is a warning, not a failure, when remote execution is not needed.
`doctor` does not send a model request or connect to remote hosts.

## 5. Run The First Research Job

```powershell
resagent research "Compare the available evidence and identify unresolved contradictions."
```

ResAgent runs five stages:

1. plan;
2. collect;
3. analyze;
4. verify;
5. report.

The terminal prints stage and provider progress. The final report is written under:

```text
.resagent/reports/<run-id>.md
```

Choose a stable project-relative path with:

```powershell
resagent research `
  --profile balanced `
  --output .resagent/reports/first-report.md `
  "Investigate the question and produce a sourced conclusion."
```

Linux:

```bash
resagent research \
  --profile balanced \
  --output .resagent/reports/first-report.md \
  "Investigate the question and produce a sourced conclusion."
```

The output path must remain inside the investigation directory.

## 6. Continue The Session

Continue the newest session in this directory:

```powershell
resagent research --continue "Re-evaluate the conclusion using the new evidence."
```

Or continue an exact session:

```powershell
resagent research --session <session-id> "Answer the follow-up question."
```

Sessions are Location-scoped and cannot be continued from another directory.

## 7. Add Remote Hosts

Skip this section for local-only research.

Remote execution accepts configured aliases, not arbitrary prompt-supplied destinations. If
OpenSSH already has a working alias, add it to `opencode.jsonc`:

```jsonc
{
  "remotes": {
    "research-a": {
      "host": "research-a",
      "host_key": "strict",
      "connect_timeout": 10,
      "command_timeout": 120000,
      "max_concurrency": 1,
      "tags": ["linux", "research"],
    },
  },
}
```

When the SSH alias does not provide user or identity settings, configure them explicitly:

```jsonc
"research-a": {
  "host": "server.example.net",
  "user": "research",
  "port": 22,
  "identity_file": "~/.ssh/id_ed25519",
  "known_hosts_file": "~/.ssh/known_hosts",
  "host_key": "strict"
}
```

Restart ResAgent after editing configuration and run `resagent doctor`. The check validates alias
configuration and local files without connecting.

Before `remote_run` starts SSH, ResAgent requests permission for every exact resource:

```text
<host-alias> <exact-command>
```

Approve only the hosts and command you intend to run. Rejecting a required resource starts no SSH
connections. Read the [security guide](resagent-security.md) before enabling remote execution.

## 8. Use The TUI

Start ResAgent from the investigation directory:

```powershell
resagent
```

Create or open a session, then press `Ctrl+P`:

- `Start research` asks for a profile and question.
- `Start research with report path` also asks for a project-relative output path.
- `Remote hosts` selects configured aliases and asks for the exact command.

Research stages, selected provider routes, active remote targets, independent host results, and
the completed report path remain visible in the session UI.

## Next Reading

- [Daily CLI and TUI usage](resagent-usage.md)
- [Complete configuration reference](resagent-configuration.md)
- [Installation and release artifacts](resagent-installation.md)
- [Security model](resagent-security.md)
- [Migrating from OpenCode](resagent-migration.md)
- [Documentation index](README.md)
