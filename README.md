# ResAgent

ResAgent is a terminal-first research agent for durable, multi-provider investigations and
permission-gated diagnostics across named SSH hosts.

It is built from OpenCode and retains OpenCode's session engine, provider catalog, permission
model, SDK boundary, TUI, and internal `@opencode-ai/*` package structure. ResAgent is an
independent distribution and is not maintained by or affiliated with the OpenCode team.

## Capabilities

- Five durable research stages: plan, collect, analyze, verify, and report.
- Ordered provider routes with bounded fallback for replay-safe, retryable failures.
- Named SSH targets with strict host-key checking, exact host-plus-command permissions,
  per-host concurrency, timeouts, cancellation, and bounded output.
- Markdown reports with provider and tool provenance.
- Terminal commands for research and diagnostics, plus TUI progress, target, and result views.

## Quick Start

Start with the [complete quickstart](docs/resagent-quickstart.md). The shortest source-based path
on Windows is:

```powershell
git clone --branch resagent --single-branch https://github.com/BoringZheng/ResAgent.git
cd ResAgent
bun install --frozen-lockfile --linker hoisted
cd packages\opencode

$env:RESAGENT_LAUNCH = "1"
bun run src\index.ts auth login
bun run src\index.ts models
```

Create a project-local `opencode.jsonc` with one research profile, using exact model identifiers
from `models`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "research": {
    "default_profile": "balanced",
    "profiles": {
      "balanced": {
        "planner": ["provider/model-planner"],
        "collector": ["provider/model-fast"],
        "analyst": ["provider/model-analyst"],
        "verifier": ["provider/model-verifier"],
        "writer": ["provider/model-writer"],
      },
    },
  },
}
```

Then run:

```powershell
bun run src\index.ts doctor
bun run src\index.ts research `
  --output .resagent/reports/first-report.md `
  "Compare the available evidence and identify unresolved contradictions."
```

Native Windows and Linux artifacts use the shorter `resagent` command:

```bash
resagent doctor
resagent research "What should be investigated?"
resagent
```

The last command opens the terminal UI. Press `Ctrl+P` and choose `Start research`,
`Start research with report path`, or `Remote hosts`.

## Documentation

- [Quickstart](docs/resagent-quickstart.md)
- [Daily CLI and TUI usage](docs/resagent-usage.md)
- [Installation and native artifacts](docs/resagent-installation.md)
- [Configuration reference](docs/resagent-configuration.md)
- [Security model](docs/resagent-security.md)
- [Migrating from OpenCode](docs/resagent-migration.md)
- [Product specification](specs/resagent.md)
- [Acceptance record](specs/resagent-acceptance.md)

ResAgent adds top-level `research` profiles and an optional `remotes` allowlist to the inherited
OpenCode configuration. Use exact model identifiers from `resagent models`, run `resagent doctor`
after every configuration change, and approve each `<alias> <exact-command>` remote resource
before it runs.

## Build A Native Artifact

From `packages/opencode`:

```bash
bun run script/build.ts --single --archive --skip-install --skip-embed-web-ui
bun run verify:resagent-release
```

Artifacts and `SHA256SUMS` are written under `packages/opencode/dist/`.

The `ResAgent native release` GitHub Actions workflow builds and verifies native Linux x64 and
Windows x64 targets. It also runs the five-stage provider E2E through each compiled binary. Tags
named `resagent-v<version>` publish the verified archives and one combined `SHA256SUMS`. macOS
release artifacts are intentionally not supported.

## Upstream

ResAgent is based on OpenCode, licensed under the MIT License. The baseline used for the initial
implementation is recorded in [the product specification](specs/resagent.md). Upstream project
and license notices are preserved to support ongoing synchronization.
