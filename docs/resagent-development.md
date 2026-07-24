# ResAgent Development

This guide covers the ResAgent-specific development path. The monorepo contains inherited
OpenCode packages and workflows; read [the documentation policy](README.md) before treating an
internal package README as product guidance.

## Requirements

- Windows x64 or Linux x64
- Git
- Bun `1.3.14`, as pinned by the root `package.json`
- OpenSSH client for remote features and `doctor`
- enough disk space for the frozen monorepo install and native executable build

macOS is not a supported development or release target for ResAgent.

## Checkout And Install

Windows PowerShell:

```powershell
git clone --branch resagent --single-branch https://github.com/BoringZheng/ResAgent.git
cd ResAgent
bun install --frozen-lockfile --linker hoisted
```

Linux:

```bash
git clone --branch resagent --single-branch https://github.com/BoringZheng/ResAgent.git
cd ResAgent
bun install --frozen-lockfile
```

The product and default branch is `resagent`. Upstream comparisons use `origin/dev`.

## Run From Source

Resolve the source entrypoint, then invoke it from the directory that should own configuration,
sessions, and reports:

```powershell
$resagent = (Resolve-Path .\packages\opencode\src\index.ts).Path
Set-Location C:\path\to\investigation
$env:RESAGENT_LAUNCH = "1"
bun run $resagent doctor
bun run $resagent research "Summarize the evidence."
bun run $resagent
```

Linux:

```bash
resagent_source="$(pwd)/packages/opencode/src/index.ts"
cd /path/to/investigation
export RESAGENT_LAUNCH=1
bun run "$resagent_source" doctor
bun run "$resagent_source" research "Summarize the evidence."
bun run "$resagent_source"
```

`RESAGENT_LAUNCH=1` selects ResAgent branding and commands in source mode. Invoking the absolute
entrypoint preserves the investigation directory as the active Location. Do not invoke
`node bin/resagent`; the package launcher expects a packaged binary layout.

## Architecture And Ownership

Runtime dependencies flow in this direction:

```text
packages/schema
    +-> packages/core ---------+
    +-> packages/protocol -----+-> packages/server
              |
              +-> packages/client

packages/sdk-next composes Client, Core, and Server.
packages/opencode hosts compatibility CLI and distribution wiring.
packages/tui uses SDK and public event boundaries.
```

ResAgent-specific ownership:

| Area                                           | Primary package                        |
| ---------------------------------------------- | -------------------------------------- |
| Research and remote config schemas             | `packages/core`                        |
| Provider route resolution and durable workflow | `packages/core`                        |
| OpenSSH inventory and `remote_run`             | `packages/core`                        |
| Public research HTTP endpoint                  | `packages/protocol`, `packages/server` |
| Generated Promise and Effect clients           | `packages/client`                      |
| CLI commands, runtime assembly, native build   | `packages/opencode`                    |
| Research progress and remote-result UI         | `packages/tui`                         |

Keep provider resolution, tool registry, permissions, filesystem access, and model execution
Location-scoped. Keep durable prompt admission separate from execution. The research workflow
must use the Session runner rather than introducing an in-memory provider loop.

## Generated Contracts

After changing the public Protocol or Server `HttpApi`:

```powershell
cd packages\client
bun run generate
```

Do not edit `src/generated` or `src/generated-effect` directly.

Regenerate the legacy JavaScript SDK with:

```bash
./packages/sdk/js/script/build.ts
```

Review source and generated changes together.

## Type Checking

Run `bun typecheck` inside each affected package. Never run `tsc` directly.

```powershell
cd packages\core
bun typecheck

cd ..\protocol
bun typecheck

cd ..\server
bun typecheck

cd ..\client
bun typecheck

cd ..\opencode
bun typecheck

cd ..\tui
bun typecheck
```

The root test script intentionally refuses to run. Root-wide type checking is not a substitute
for package-local validation of the changed behavior.

## Focused Tests

Run tests from the package that owns them:

```powershell
cd packages\core
bun test test\config\research.test.ts test\research-route.test.ts
bun test test\remote.test.ts test\tool-remote-run.test.ts
```

```powershell
cd packages\opencode
bun test test\server\httpapi-sdk.test.ts
bun test test\cli\research-process.test.ts --timeout 90000
```

```powershell
cd packages\tui
bun test test\util\research-state.test.ts test\util\remote-run.test.ts
```

Test filenames may evolve; use `rg --files test` in the package to locate the current focused
suite. Expand coverage for changes that cross package boundaries or affect public contracts,
Session execution, permissions, cancellation, report integrity, or release output.

Avoid mocks when the actual implementation can run deterministically. Do not duplicate
production logic in tests.

## Real SSH Acceptance

Local OpenSSH fixtures are preferred. If real-host acceptance is required, only these configured
aliases are approved:

```text
tor-client
tor-hs
```

Never connect to another target or to any alias beginning with `az-`. Keep commands read-only,
authorize exact resources, preserve independent per-host outcomes, and remove temporary files.
Do not record addresses, usernames, key paths, or private host metadata in repository artifacts.

## Native Build And E2E

From `packages/opencode`:

```bash
bun run script/build.ts --single --archive --skip-install --skip-embed-web-ui
bun run verify:resagent-release
```

To run the packaged workflow test against the compiled binary, set `RESAGENT_TEST_BINARY` to the
absolute executable path and run:

```bash
bun test test/cli/research-process.test.ts --timeout 90000
```

Native release evidence must come from the matching operating system. Windows builds do not
replace Linux release evidence, and Linux builds do not replace Windows release evidence.

## Documentation Checks

Format maintained Markdown files from the repository root:

```powershell
bun x prettier --write README.md README.zh.md CONTRIBUTING.md SECURITY.md "docs/*.md" "specs/resagent*.md" ".github/**/*.md"
```

Then check:

```powershell
bun x prettier --check README.md README.zh.md CONTRIBUTING.md SECURITY.md "docs/*.md" "specs/resagent*.md" ".github/**/*.md"
git diff --check
```

Validate relative links and scan authoritative documents for stale upstream installation,
support, macOS, Discord, and vulnerability-reporting claims. References to OpenCode are expected
only for attribution, compatibility, migration, internal package names, or inherited behavior.

## Review Checklist

- Behavior and docs agree with current executable schemas and CLI flags.
- Tests run from package directories and cover the changed boundary.
- Public API changes include regenerated clients.
- Remote authorization occurs before connection.
- No secret, private host detail, or command output is committed accidentally.
- Windows and Linux support claims match the native workflow.
- macOS instructions have not been introduced.
- The acceptance record is updated when release or E2E evidence changes.
