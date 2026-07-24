# ResAgent

**A terminal-first research agent for durable, multi-provider investigations and permission-gated work on named SSH hosts.**

[![Native release](https://github.com/BoringZheng/ResAgent/actions/workflows/resagent-release.yml/badge.svg?branch=resagent)](https://github.com/BoringZheng/ResAgent/actions/workflows/resagent-release.yml)
[![Platforms](https://img.shields.io/badge/platform-Windows%20x64%20%7C%20Linux%20x64-4c8bf5)](#platform-support)
[![License](https://img.shields.io/badge/license-MIT-2ea44f)](LICENSE)

[English](README.md) | [简体中文](README.zh.md)

ResAgent turns a research question into a durable five-stage workflow: plan, collect, analyze,
verify, and report. Each stage uses an explicit ordered model route. The same session can collect
local evidence, use configured tools, and run approved commands across an allowlist of remote
hosts without giving the model arbitrary SSH access.

ResAgent is built from [OpenCode](https://github.com/anomalyco/opencode). It preserves OpenCode's
provider catalog, session engine, permission model, TUI, and internal package boundaries while
shipping an independent `resagent` distribution. It is not maintained by or affiliated with the
OpenCode team.

## Project Status

ResAgent is a **release candidate**. The complete research workflow, Windows and Linux native
builds, compiled-binary E2E tests, multi-provider routing, report export, and bounded SSH
execution are implemented and covered by the native release workflow.

The compatibility contract is not yet stable. Pin a release tag or commit for repeatable use.
The product and default branch is `resagent`. Source commands still select it explicitly so a
checkout cannot silently follow an upstream branch.

## Why ResAgent

- **Durable research workflow.** Provider attempts and stage progress are recorded in the
  session instead of living in a second in-memory agent loop.
- **Multi-provider routes.** Each role has an ordered `provider/model` route with bounded fallback
  only for classified replay-safe failures.
- **Remote evidence collection.** `remote_run` targets configured aliases, authorizes every exact
  `<host> <command>` resource, and returns independent per-host results.
- **Inspectable reports.** Markdown output includes conclusions, limitations, provider attempts,
  and relevant tool provenance.
- **CLI and TUI parity.** Run non-interactively in automation or start the interactive terminal
  UI for provider setup, research progress, target selection, and result inspection.
- **Release verification.** Native archives include checksums and are tested through the compiled
  executable on native Windows and Linux runners.

## How It Works

```text
research question
      |
      v
plan -> collect -> analyze -> verify -> report
  |        |          |          |        |
  +--------+----------+----------+--------+
                    |
          ordered provider routes
                    |
          configured model providers

collect may call remote_run
          |
          +-> exact permission: <alias> <command>
          +-> OpenSSH -> configured host allowlist
          +-> bounded per-host result
```

The workflow is session-owned and location-scoped. The directory where ResAgent starts determines
the project configuration, sessions, remote inventory, and allowed report paths.

## Platform Support

| Platform    | Native artifact             | Source development | Status       |
| ----------- | --------------------------- | ------------------ | ------------ |
| Windows x64 | `resagent-windows-x64.zip`  | Supported          | Supported    |
| Linux x64   | `resagent-linux-x64.tar.gz` | Supported          | Supported    |
| macOS       | None                        | Not supported      | Out of scope |

There is no macOS compatibility or release commitment. The desktop application and upstream
OpenCode package-manager channels are not ResAgent distribution channels.

## Quick Start

For normal use, install a verified native archive by following the
[installation guide](docs/resagent-installation.md). To run the current source branch on Windows:

```powershell
git clone --branch resagent --single-branch https://github.com/BoringZheng/ResAgent.git
cd ResAgent
bun install --frozen-lockfile --linker hoisted

$resagent = (Resolve-Path .\packages\opencode\src\index.ts).Path
New-Item -ItemType Directory -Path ..\resagent-workspace -Force | Out-Null
Set-Location ..\resagent-workspace
$env:RESAGENT_LAUNCH = "1"
bun run $resagent auth login
bun run $resagent models
```

Create `opencode.jsonc` in the directory where the investigation will run. Replace every example
model with an exact identifier from `models`:

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

Then check the environment and run the first investigation:

```powershell
bun run $resagent doctor
bun run $resagent research `
  --output .resagent/reports/first-report.md `
  "Compare the available evidence and identify unresolved contradictions."
```

An installed native artifact uses the shorter commands:

```bash
resagent doctor
resagent research "What conclusion is supported by the evidence?"
resagent
```

The last command opens the TUI. The [quickstart](docs/resagent-quickstart.md) covers provider
login, profile creation, report export, session continuation, and optional remote hosts end to
end.

## Remote Execution

Remote execution is opt-in. A prompt cannot introduce a new hostname; it can only select aliases
defined under `remotes`.

```jsonc
{
  "remotes": {
    "research-a": {
      "host": "research-a",
      "host_key": "strict",
      "command_timeout": 120000,
      "max_concurrency": 1,
      "tags": ["linux", "research"],
    },
  },
}
```

Before any SSH process starts, ResAgent resolves every alias and requests permission for each
exact resource:

```text
research-a uname -a
```

ResAgent invokes OpenSSH directly, enables batch mode, disables forwarding and interactive
password authentication, enforces host-key verification, bounds output and execution time, and
preserves one status per host. The permission system is still a policy and awareness boundary,
not an operating-system sandbox. Read the [security guide](docs/resagent-security.md) before
granting remote access.

## Documentation

| Document                                          | Audience            | Purpose                                              |
| ------------------------------------------------- | ------------------- | ---------------------------------------------------- |
| [Documentation index](docs/README.md)             | Everyone            | Authority, navigation, and inherited-doc policy      |
| [Quickstart](docs/resagent-quickstart.md)         | New users           | First provider, profile, report, and optional host   |
| [Installation](docs/resagent-installation.md)     | Users               | Native artifacts, checksums, source mode, and builds |
| [Configuration](docs/resagent-configuration.md)   | Users and operators | Profiles, provider routes, hosts, and permissions    |
| [Usage](docs/resagent-usage.md)                   | Users               | CLI, TUI, sessions, reports, and troubleshooting     |
| [Security](docs/resagent-security.md)             | Operators           | Trust boundaries and deployment guidance             |
| [Migration](docs/resagent-migration.md)           | OpenCode users      | Compatibility and rollback                           |
| [Development](docs/resagent-development.md)       | Contributors        | Repository setup, architecture, tests, and review    |
| [Release process](docs/resagent-releasing.md)     | Maintainers         | Native workflow, tags, checksums, and verification   |
| [Product specification](specs/resagent.md)        | Maintainers         | Product and architecture contract                    |
| [Acceptance record](specs/resagent-acceptance.md) | Maintainers         | Test evidence and residual risks                     |

## Architecture

ResAgent follows the repository's existing dependency direction:

```text
Schema
  +-> Core
  +-> Protocol
        +-> Server
        +-> Client

sdk-next composes Client, Core, and Server.
packages/opencode hosts the compatibility CLI and native distribution.
packages/tui consumes public SDK boundaries.
```

Research configuration, provider routing, workflow state, SSH inventory, and `remote_run` live in
Core. Public HTTP contracts live in Protocol and Server. Distribution commands and release
packaging live in `packages/opencode`; interactive views live in `packages/tui`.

## Development

ResAgent requires the Bun version pinned in the root `package.json`. Install the frozen lockfile,
then run checks from the affected package rather than from the repository root:

```powershell
bun install --frozen-lockfile --linker hoisted
cd packages\opencode
bun typecheck
bun test test\cli\research-process.test.ts --timeout 90000
bun run script\build.ts --single --archive --skip-install --skip-embed-web-ui
bun run verify:resagent-release
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[development guide](docs/resagent-development.md) before changing public APIs, generated clients,
remote behavior, or release automation.

## Known Limitations

- macOS is unsupported.
- Native distribution currently targets Windows x64 and Linux x64 only.
- Research profiles and remote inventory are configured in inherited `opencode.json[c]` paths;
  the schema URL and internal `@opencode-ai/*` package names remain upstream-compatible.
- Some inherited CLI help or internal implementation text may still say `opencode`; invoke the
  standalone distribution as `resagent`.
- Remote execution uses OpenSSH only. Password authentication, WinRM, Kubernetes, and arbitrary
  long-lived remote jobs are outside the current scope.
- The permission UI does not sandbox the local process or make an approved command harmless.
- Branch CI artifacts expire after 14 days. Tagged releases are the durable distribution channel.

## Contributing And Security

Contributions should target the `resagent` branch and use conventional titles such as
`fix(core): preserve remote result order`. Read [CONTRIBUTING.md](CONTRIBUTING.md) for branch,
test, generated-code, and remote-test rules. Participation is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md).

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md) to report it
privately through this repository's GitHub Security Advisory form.

## License And Attribution

ResAgent is distributed under the [MIT License](LICENSE). It is derived from OpenCode and retains
upstream copyright, license notices, package names, and implementation history. ResAgent-specific
documentation, branding, workflow behavior, and release artifacts belong to this fork and do not
imply endorsement by the OpenCode maintainers.
