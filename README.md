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

## Build And Run

Requirements:

- Bun `1.3.14`
- OpenSSH client for remote execution
- Git

```bash
git clone <resagent-repository>
cd ResAgent
bun install

cd packages/opencode
bun run src/index.ts doctor
bun run src/index.ts research "What should be investigated?"
```

The source entrypoint uses the upstream-compatible command name in help output. The standalone
wrapper and compiled release artifacts use `resagent`:

```bash
packages/opencode/bin/resagent doctor
packages/opencode/bin/resagent research "Compare the configured evidence"
```

Build a native archive and checksum for the current platform:

```bash
cd packages/opencode
bun run script/build.ts --single --archive --skip-install --skip-embed-web-ui
```

Artifacts are written under `packages/opencode/dist/`, including `SHA256SUMS`.
Verify the archive member, executable metadata, checksum, extracted binary, and version with:

```bash
bun run verify:resagent-release
```

The `ResAgent native release` GitHub Actions workflow builds and verifies native Linux x64 and
Windows x64 targets. It also runs the five-stage provider E2E through each compiled binary. Tags
named `resagent-v<version>` publish the verified archives and one combined `SHA256SUMS`. macOS
release artifacts are intentionally not supported.

## Configuration

ResAgent uses the existing OpenCode configuration lifecycle and adds top-level `research` and
`remotes` fields. See:

- [Installation](docs/resagent-installation.md)
- [Configuration](docs/resagent-configuration.md)
- [Migration](docs/resagent-migration.md)
- [Security](docs/resagent-security.md)
- [Product specification](specs/resagent.md)
- [Acceptance record](specs/resagent-acceptance.md)

Minimal example:

```jsonc
{
  "research": {
    "default_profile": "balanced",
    "profiles": {
      "balanced": {
        "planner": ["openai/gpt-5", "anthropic/claude-sonnet"],
        "collector": ["openai/gpt-5-mini"],
        "analyst": ["openai/gpt-5"],
        "verifier": ["anthropic/claude-sonnet"],
        "writer": ["openai/gpt-5"],
      },
    },
  },
  "remotes": {
    "lab-a": {
      "host": "lab-a.example.net",
      "user": "research",
      "identity_file": "~/.ssh/id_ed25519",
      "known_hosts_file": "~/.ssh/known_hosts",
      "host_key": "strict",
    },
  },
}
```

Run `resagent doctor` after configuration. It verifies provider inventory, all five research
routes, OpenSSH availability, remote path references, and report-directory writability without
printing credentials or command output.

## Upstream

ResAgent is based on OpenCode, licensed under the MIT License. The baseline used for the initial
implementation is recorded in [the product specification](specs/resagent.md). Upstream project
and license notices are preserved to support ongoing synchronization.
