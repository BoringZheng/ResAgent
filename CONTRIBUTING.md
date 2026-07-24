# Contributing To ResAgent

ResAgent accepts focused bug fixes, tests, documentation improvements, provider compatibility
work, research workflow improvements, and security hardening. Open an issue before substantial
new product behavior so the problem, architecture, and acceptance criteria can be agreed before
implementation.

ResAgent is derived from OpenCode. Changes intended only for upstream OpenCode should be proposed
to the upstream project. Changes to ResAgent's research workflow, provider routing, remote
execution, terminal experience, documentation, or native release process belong here.

## Before You Start

- Read the [documentation index](docs/README.md) and
  [development guide](docs/resagent-development.md).
- Use the Bun version pinned by the root `package.json`.
- Develop on Windows x64 or Linux x64. macOS is not a supported ResAgent target.
- Base work on the `resagent` branch.
- Keep the change scoped. Do not mix upstream synchronization, generated output, refactoring, and
  product behavior in one pull request unless they are inseparable.

## Set Up The Repository

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

Resolve the ResAgent source entrypoint and run it from a disposable investigation directory:

```powershell
$resagent = (Resolve-Path .\packages\opencode\src\index.ts).Path
New-Item -ItemType Directory -Path ..\resagent-dev-workspace -Force | Out-Null
Set-Location ..\resagent-dev-workspace
$env:RESAGENT_LAUNCH = "1"
bun run $resagent doctor
```

Do not use `node bin/resagent` from a source checkout. That launcher expects an installed native
binary layout.

## Branches, Commits, And Pull Requests

Branch names contain at most three lowercase words separated by hyphens, without a type prefix:

```text
session-recovery
remote-timeout
docs-refresh
```

Commit messages and pull request titles use:

```text
type(scope): summary
```

Allowed types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Useful scopes include
`core`, `opencode`, `tui`, `server`, `client`, `sdk`, and `docs`.

Examples:

```text
fix(core): preserve remote result order
docs: clarify native artifact verification
test(opencode): cover research session continuation
```

A pull request must explain:

1. the user-visible or architectural problem;
2. the chosen solution and important tradeoffs;
3. exact verification commands and results;
4. residual risks or checks that were not run;
5. screenshots or terminal captures for visible TUI changes.

Link an issue when one exists. An issue is expected for security-sensitive changes, public API
changes, new product behavior, and work with a broad cross-package impact.

Repository automation may label an issue or pull request when required information is missing.
The author has seven days to correct the template or linked-issue requirements before automatic
closure, and may open a corrected contribution afterward.

## Engineering Rules

Follow [AGENTS.md](AGENTS.md) and the patterns in the surrounding package. In particular:

- preserve the dependency direction documented in the
  [development guide](docs/resagent-development.md);
- keep durable prompt admission separate from model execution;
- keep research orchestration in the durable Session runner;
- authorize every remote alias and exact command before opening any SSH connection;
- never add a local shell around model-controlled SSH input;
- avoid unrelated refactors and direct edits to generated code;
- keep credentials, private-key contents, authorization headers, and secret-bearing output out
  of logs, fixtures, snapshots, and reports.

## Generated Code

Do not edit generated clients directly.

- After changing the public Protocol or Server `HttpApi`, run `bun run generate` from
  `packages/client`.
- To regenerate the legacy JavaScript SDK, run
  `./packages/sdk/js/script/build.ts`.
- Review generated diffs and include them in the same change as their source contract.

## Tests And Type Checking

The root test command intentionally fails. Run checks from package directories.

```powershell
cd packages\core
bun typecheck
bun test test\config\research.test.ts test\remote.test.ts test\tool-remote-run.test.ts
```

```powershell
cd packages\opencode
bun typecheck
bun test test\cli\research-process.test.ts --timeout 90000
```

Select tests according to the change's blast radius. Public API, shared Core behavior, Session
execution, remote authorization, and release changes require broader package coverage than a
documentation-only edit. Record known platform-specific upstream failures instead of hiding
them, and verify that the same failure is unrelated to the proposed change.

For documentation changes, run the formatting and link checks described in
[the development guide](docs/resagent-development.md).

## Remote Test Policy

Repository tests should use local fixtures whenever possible. When real SSH acceptance is
necessary, the only approved aliases are:

```text
tor-client
tor-hs
```

Do not connect to any other SSH target. In particular, never connect to a host whose alias starts
with `az-`. Use read-only commands unless the test has an explicit, reviewed cleanup design.
Record the aliases and exact commands in the acceptance evidence, do not expose host connection
details, and remove temporary remote files after the test.

## Native Builds

Build and verify the current host platform from `packages/opencode`:

```bash
bun run script/build.ts --single --archive --skip-install --skip-embed-web-ui
bun run verify:resagent-release
```

Windows artifacts must be built and tested on Windows; Linux artifacts must be built and tested
on Linux. Cross-built output is not release evidence. macOS artifacts are not produced.

## Documentation

The root `README.md` is the project homepage. `docs/` contains user and maintainer guidance;
`specs/` contains architecture and acceptance records. Keep procedures in one authoritative
document and link to them rather than copying long command sequences across files.

English is authoritative. `README.zh.md` is the maintained Simplified Chinese overview. Do not
add a translated README unless there is a clear owner for keeping it aligned.

## Security

Do not report vulnerabilities in a public issue or pull request. Follow
[SECURITY.md](SECURITY.md). Changes involving permissions, credentials, SSH construction,
provider error handling, report redaction, or release integrity require an explicit security
review section in the pull request.

## Code Of Conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Be direct and technical,
review the change rather than the contributor, and report security or credential exposure
privately.
