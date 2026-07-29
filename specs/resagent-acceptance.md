# ResAgent Implementation And Acceptance Record

Status: Accepted; fork CI verified on native Linux x64 and Windows x64

Last reviewed: 2026-07-27

## 1. Delivery Sequence

### Phase 0: Repository Baseline

- [x] Clone OpenCode and preserve upstream history.
- [x] Create the `resagent` branch.
- [x] Pin the initial upstream commit in the specification.
- [x] Install the repository-required Bun version.
- [x] Complete dependency installation.
- [x] Record a clean upstream package test baseline.

Current environment note: direct Windows access to the public npm registry is blocked, so a
temporary WSL CONNECT proxy was used to complete a frozen-lockfile install without changing
repository registry configuration, dependency versions, or `bun.lock`. Windows and native Linux
now use the lockfile's `@opentui/core`, `@opentui/keymap`, and `@opentui/solid` `0.4.5`. The
temporary proxy and staging workspaces were removed after verification.

The final Windows recovery used Bun's hoisted linker because this execution environment rejects
directory Junction traversal as an untrusted mount point. All package-local links left by the
interrupted isolated install were quarantined, all eight affected package typechecks passed
against the hoisted tree, and the quarantine was removed. The final `bun.lock` SHA-256 remained
`8b4139148b20f53e9a97472a95cff8fe3af7e492714c315151561952c25c8b97`.

### Phase 1: Remote Core

- [x] Add remote host configuration schema.
- [x] Add alias resolution and immutable Location-scoped host inventory.
- [x] Add OpenSSH invocation builder.
- [x] Add per-host concurrency and timeout enforcement.
- [x] Add `remote_run` canonical tool.
- [x] Add exact permission resources.
- [x] Add unit and integration tests.

### Phase 2: Research Core

- [x] Add research profile schema.
- [x] Add stage-owned provider route selection.
- [x] Add retryable failure classification and fallback.
- [x] Add research stage state and provenance.
- [x] Add Markdown report export.
- [x] Add deterministic tests with local provider-compatible fixtures.

### Phase 3: Terminal UX

- [x] Add provider route and health display.
- [x] Add remote host picker and target summary.
- [x] Add multi-host result renderer with partial-failure states.
- [x] Add research progress and evidence views.
- [x] Add report export command.
- [x] Verify keyboard-only and narrow-terminal behavior.

### Phase 4: Diagnostics and Distribution

- [x] Add `resagent doctor`.
- [x] Add project branding and upstream attribution.
- [x] Add an OSS project README, documentation index, installation, configuration, usage,
      migration, development, release, and security documentation.
- [x] Align contribution, vulnerability-reporting, issue, and pull request governance with
      ResAgent.
- [x] Remove stale root translations that presented upstream OpenCode as ResAgent.
- [x] Add release scripts and checksums.
- [x] Add native Linux/Windows release-runner automation.
- [x] Run the five-stage provider E2E through the compiled release binary.
- [x] Build and smoke-test the Windows x64 artifact.
- [x] Build and smoke-test the Linux x64 artifact on a native host.
- [x] Validate the final commit on native Linux x64 and Windows x64 release runners.

## 2. Automated E2E Matrix

The E2E harness uses:

- two disposable local OpenSSH servers with different host keys;
- one unreachable target;
- two independent local OpenAI-compatible fixture servers;
- a temporary home directory, config directory, known-hosts file, and SQLite database;
- no real provider or SSH credentials.

| ID      | Scenario                   | Expected Evidence                                              |
| ------- | -------------------------- | -------------------------------------------------------------- |
| E2E-P01 | First provider succeeds    | Selected route and report stage use provider 1                 |
| E2E-P02 | Retryable provider failure | Provider 2 is selected once within budget                      |
| E2E-P03 | Authentication failure     | No fallback; actionable error shown                            |
| E2E-P04 | Both providers unavailable | Route attempts listed; session remains usable                  |
| E2E-R01 | Execute on one host        | Exact stdout, exit, duration, and alias returned               |
| E2E-R02 | Execute on two hosts       | Stable input ordering and independent results                  |
| E2E-R03 | One host times out         | Other host succeeds; timed-out host is explicit                |
| E2E-R04 | Host key mismatch          | Connection fails before command execution                      |
| E2E-R05 | Permission rejected        | SSH fixture records zero connections                           |
| E2E-R06 | Permission corrected       | Original command does not run; corrected prompt continues      |
| E2E-R07 | Cancellation               | SSH process ends and remaining hosts are cancelled             |
| E2E-R08 | Large output               | Per-host result is truncated and retained output is bounded    |
| E2E-R09 | Metacharacters in command  | No local file or process side effect occurs                    |
| E2E-X01 | Full research run          | Report contains citations, confidence, and execution appendix  |
| E2E-X02 | Conflicting evidence       | Verification stage records conflict and qualified conclusion   |
| E2E-X03 | Secret canary              | Canary absent from model output, logs, report, and artifacts   |
| E2E-U01 | TUI 80x24                  | No overlap; all primary actions keyboard accessible            |
| E2E-U02 | TUI reconnect              | Session and pending state recover without duplicated execution |

## 3. Review Loop

Every implementation slice follows:

1. Update the relevant specification and acceptance rows.
2. Implement the smallest complete behavior at an existing package boundary.
3. Add tests against the real implementation.
4. Run format, typecheck, focused tests, and relevant broader tests.
5. Review the diff for:
   - security invariant violations;
   - package dependency direction;
   - error and cancellation behavior;
   - secret exposure;
   - Windows and POSIX behavior;
   - missing tests and user-visible states.
6. Fix findings before starting the next slice.
7. Record commands and evidence in the completion audit.

## 4. Documentation Review 1

Date: 2026-07-23

Findings:

1. **Critical:** Treating remote execution as a raw `ssh` shell string would bypass structured target permissions and allow local option injection.
   Resolution: use a dedicated canonical tool and argument-array invocation.
2. **Critical:** Reusing the experimental remote workspace credential transfer would expose all configured provider credentials to a remote host.
   Resolution: keep provider execution local for 1.0 and defer remote workspace mode.
3. **High:** "Multi-provider" was ambiguous between configuration and automatic failover.
   Resolution: define ordered role routes, failure classes, safe replay, and retry budgets.
4. **High:** Multi-host partial failures could be summarized as total success.
   Resolution: require a typed per-host result and stable ordering.
5. **High:** Permission prompts could become too broad.
   Resolution: resource identity includes exact host alias and command.
6. **Medium:** SSH connection setup could permit forwarding or interactive prompts.
   Resolution: require batch mode, clear forwarding, no local shell, strict host keys, and explicit timeouts.
7. **Medium:** The original scope lacked measurable UX acceptance.
   Resolution: add 80x24 and reconnect E2E scenarios.
8. **Medium:** The dependency mirror failure could tempt an unreviewed downgrade.
   Resolution: preserve the lockfile and track the environment issue in Phase 0.

Result: The specification is sufficiently concrete to begin Phase 1. Remote workspace mode remains blocked by a separate security design.

## 5. Documentation Review 2

Date: 2026-07-23

Findings:

1. **High:** The draft referred to a `shell: false` option that is not part of the repository's Effect `ChildProcess.make` usage.
   Resolution: specify direct `ChildProcess.make("ssh", args, ...)` invocation and test the resulting argument list.
2. **High:** `ClearAllForwardings` alone did not explicitly disable agent forwarding, X11 forwarding, or local commands.
   Resolution: add `ForwardAgent=no`, `ForwardX11=no`, and `PermitLocalCommand=no`.
3. **Medium:** Batch mode did not state the 1.0 password-authentication policy strongly enough.
   Resolution: add `PasswordAuthentication=no` and keep password-based SSH out of scope.
4. **Medium:** Layered host config behavior was unspecified.
   Resolution: later config documents replace an alias as a complete entry, and inventory remains fixed for the Location lifetime.

Result: Phase 1 may begin against the corrected process and config contracts.

## 6. Code Review 1

Date: 2026-07-23

Findings:

1. **High:** A config containing legacy V1 keys and the new `remotes` field would enter V1 migration and silently lose the host inventory.
   Resolution: add `remotes` to the V1 compatibility schema and preserve it during migration.
2. **High:** `AppProcessError.command` and OpenSSH stderr may contain configured identity or known-hosts paths.
   Resolution: never expose the process error command and redact configured sensitive paths from all remote stdout/stderr.
3. **Medium:** Password authentication was disabled but keyboard-interactive authentication was only indirectly prevented by batch mode.
   Resolution: add `KbdInteractiveAuthentication=no` to the invariant argument list.
4. **Medium:** The full monorepo typecheck currently stops on an unchanged enterprise declaration-file syntax error.
   Resolution: require package-local core typecheck for this slice and retain the monorepo failure as baseline evidence until the upstream file or generated artifact is corrected.

Result: Findings are fixed in the implementation and covered by focused tests.

## 6A. Documentation Review 3

Date: 2026-07-24

Findings:

1. **Critical:** Root translated READMEs still advertised upstream OpenCode installation,
   releases, desktop applications, macOS support, badges, and support channels.
   Resolution: keep English as the authority, maintain one aligned Simplified Chinese overview,
   and remove unsupported stale translations.
2. **High:** `CONTRIBUTING.md`, `SECURITY.md`, issue forms, and the pull request template governed
   the upstream OpenCode project rather than ResAgent.
   Resolution: replace them with ResAgent branch, package-test, security disclosure, remote-test,
   and review rules.
3. **High:** The root README did not explain maturity, supported platforms, architecture,
   security boundaries, development, contribution, release status, or known limitations.
   Resolution: rebuild it as the project homepage and link detailed procedures through a
   documentation index.
4. **Medium:** Repeated setup procedures had no declared source of truth, and inherited package
   READMEs could be mistaken for product documentation.
   Resolution: define document authority and mark package documentation as inherited
   implementation material unless explicitly ResAgent-specific.
5. **Medium:** The specification overstated `doctor` as checking runtime versions and optional SSH
   connectivity.
   Resolution: align the specification with its actual inventory, route, OpenSSH, local file, and
   report-writability checks.
6. **High:** The fork defaulted to upstream `dev`, so the GitHub homepage, issue forms, security
   policy, and direct clones did not expose the ResAgent product branch.
   Resolution: make `resagent` the repository default while keeping `origin/dev` as the upstream
   comparison baseline.
7. **Medium:** Inherited compliance automation allowed only two hours to correct an issue or pull
   request before automatic closure.
   Resolution: align templates, links, required sections, and issue policy with ResAgent, and
   extend the correction window to seven days.

Result: The public documentation now has one supported-product narrative, one installation
branch, one platform matrix, one security disclosure path, and explicit boundaries for inherited
OpenCode documentation.

## 7. Phase 1 Completion Audit

Requirement: Remote host configuration and immutable Location inventory.
Implementation: `packages/core/src/config/remote.ts`, `packages/core/src/remote.ts`, and the
top-level V2/V1 compatibility config schemas.
Automated evidence: config decoding, alias replacement, path expansion, argument construction,
redaction, and inventory tests pass in `packages/core/test/config/remote.test.ts` and
`packages/core/test/remote.test.ts`.
Manual evidence: code review verified that later config documents replace complete aliases and
that inventory is captured when the Location service is built.
Residual risk: target-native optional packages remain verified per release host; final fork CI
evidence is pending.

Requirement: Secure, bounded OpenSSH execution.
Implementation: direct argument-array invocation with batch mode, disabled forwarding and local
commands, disabled password and keyboard-interactive authentication, strict host keys by default,
per-host semaphores, cancellation, timeouts, output limits, and sensitive-path redaction.
Automated evidence: `packages/core/test/remote.test.ts` covers invariant arguments, timeout,
cancellation, concurrency, output truncation, and redaction.
Manual evidence: code review found no shell interpolation or process-error command exposure.
Residual risk: the final commit still requires release-runner evidence.

Requirement: Canonical multi-host `remote_run` tool and exact authorization.
Implementation: `packages/core/src/tool/remote-run.ts` resolves and authorizes every
`<alias> <command>` resource before opening any connection, then returns stable per-host results.
Automated evidence: `packages/core/test/tool-remote-run.test.ts` covers single and multi-host
execution, ordering, independent failure, all-before-connect authorization, and conditional tool
registration.
Manual evidence: code review verified that permission denial starts zero SSH processes.
Residual risk: cancellation remains Effect interruption rather than a durable model-visible
`cancelled` result, matching the canonical tool interruption contract.

Verification run on 2026-07-23:

- `bun typecheck` in `packages/core`: pass.
- Focused research and remote tests: 32 pass, 0 fail.
- Full `packages/core` suite: 1115 pass, 7 skip, 2 fail.
- One broad-suite failure is a load-sensitive five-second timeout in `test/git.test.ts`.
- The repeatable Windows baseline failure remains:
  `test/effect/cross-spawn-spawner.test.ts:200` expects unquoted POSIX `echo` output while Windows
  returns `"hello from stdout"`.

## 8. Phase 2 Completion Audit

Requirement: Durable five-stage research workflow and provenance.
Implementation: `packages/core/src/config/research.ts`, `packages/core/src/research-route.ts`,
`packages/core/src/research-run.ts`, and `packages/core/src/research-workflow.ts`.
Automated evidence: focused research tests, session-runner fallback/restart tests, CLI process
tests, generated SDK tests, and the public HTTP workflow test pass.
Manual evidence: review verified one durable provider attempt record per dispatch, safe replay
gates before fallback, and report paths constrained to the active Location.
Residual risk: provider protocol coverage currently uses OpenAI-compatible fixture servers;
Anthropic-compatible fixture transport remains desirable cross-protocol coverage.

Requirement: Provider route classification and fallback.
Implementation: research stage routes resolve against the Location catalog and retry only
classified replay-safe failures before assistant output or tool side effects.
Automated evidence: `packages/opencode/test/server/httpapi-sdk.test.ts` covers first-route success,
three HTTP 503 attempts followed by fallback, HTTP 401 without fallback, and both routes exhausted
while the Session remains usable.
Manual evidence: durable history records the ordered attempts and terminal outcome.
Residual risk: external providers may classify vendor-specific errors differently from fixtures.

## 9. Phase 3 Completion Audit

Requirement: Research progress, provider route state, and reconnect recovery.
Implementation: durable history hydration and live event projection in
`packages/tui/src/context/data.tsx` plus the research sidebar plugin.
Automated evidence: pagination, in-flight hydration/live-event merging, duplicate event IDs, and
zero research-start calls during refresh pass in TUI tests.
Manual evidence: the initial-refresh map race was found during review and fixed before acceptance.
Residual risk: global SSE reconnect behavior still depends on the inherited SDK event source.

Requirement: Remote target selection and independent result rendering.
Implementation: remote picker command, per-Session staged target state, target sidebar, and the
dedicated `remote_run` renderer.
Automated evidence: command registration, parser tests, dedicated display selection, and rendered
partial-success/failure/timeout/truncation layouts pass at `80x24` and `120x40`.
Manual evidence: long aliases, commands, routes, and output remain bounded without overlap.
Residual risk: mouse expansion is supplementary; keyboard-only command initiation remains through
the command palette.

## 10. E2E Evidence

Real SSH evidence on Windows OpenSSH:

- `packages/core/test/remote-e2e.test.ts`: 6 pass, 0 fail.
- Covers two host keys, stable order, unreachable target, timeout, host-key mismatch, large-output
  truncation, local metacharacter isolation, nonnegative durations and exact exit codes,
  permission denial/correction with zero connections for the rejected command, successful
  execution of the subsequent corrected command, in-flight process termination, and no start of
  the queued second host.

Allowed-host acceptance on 2026-07-23:

- The production `Remote.Service` connected only to the explicitly approved `tor-client` and
  `tor-hs` aliases and ran a read-only marker plus `uname -s` and `uname -m`.
- Both hosts returned `ok`, exit code `0`, `Linux`, `x86_64`, and untruncated output while
  preserving the requested alias order.
- The same two-host command passed through the canonical `remote_run` registry and permission
  chain. One exact permission assertion contained only the two `<alias> <command>` resources, and
  the structured tool result preserved independent per-host status and duration.
- No `az-*` host or any other SSH target was connected during this acceptance run.

Provider and public API evidence:

- `packages/opencode/test/server/httpapi-sdk.test.ts`: 25 pass, 0 fail; the provider matrix and
  five-stage SDK workflow pass against independently listening HTTP fixtures.
- The completed five-stage report contains citation, confidence, limitations, and provider/tool
  provenance sections.
- Conflicting collection evidence reaches the verification stage and produces a qualified,
  conditional conclusion instead of an unqualified answer.
- Generated clients and OpenAPI contract include `POST /api/session/:sessionID/research`.
- OpenAPI and CLI unit group: 22 pass, 0 fail.

TUI evidence:

- Focused reconnect, command, parser, and layout group: 30 pass, 0 fail.
- Production sidebar and remote result JSX render at `80x24` and `120x40`.
- Full `packages/tui` suite: 204 pass, 1 skip, 1 fail. The remaining failure is the known Windows
  path-separator expectation where the test expects `~/project` and runtime returns `~\project`.

Secret-canary evidence:

- `packages/opencode/test/cli/research-process.test.ts`: 1 pass, 0 fail.
- A unique process-environment canary is absent from CLI stdout, progress stderr, and the exported
  Markdown report.
- High-confidence secret scans found no actual private-key headers or credential-token patterns in
  changed source, generated clients, tests, documentation, or the Windows release artifact.
- No retained logs, reports, or test-result artifacts remain in the workspace after the test run.

## 11. Distribution Audit

Requirement: Standalone branding and attribution.
Implementation: ResAgent README, standalone wrapper, compiled `resagent` CLI name and artifacts,
and explicit OpenCode attribution while internal package names remain upstream-compatible.
Automated evidence: branding unit test and package typecheck pass.
Residual risk: package-manager publication metadata remains intentionally separate from the
upstream OpenCode publish automation.

Requirement: Release artifacts and checksums.
Implementation: `packages/opencode/script/build.ts --archive` emits platform archives and
`SHA256SUMS`; `packages/opencode/script/verify-release.ts` verifies checksum, member identity,
executable metadata, extraction, size, and exact version output. The standalone
`.github/workflows/resagent-release.yml` runs this on native Linux x64 and Windows x64 runners,
executes the five-stage provider workflow through each compiled binary, and publishes combined
checksums for `resagent-v*` tags. Pushes to the `resagent` branch and relevant pull requests run
the same non-publishing native validation matrix, so release evidence can be gathered before
creating a tag.
Automated evidence: fork workflow run
`https://github.com/BoringZheng/ResAgent/actions/runs/30064679805` validated commit
`9ff32c55d0adf70fca0d3f89328cc882dd9a191e` on native `ubuntu-24.04` and `windows-2025`
x64 runners. Both jobs passed the package typecheck, native archive build, archive and extracted
binary verifier, exact-version smoke test, compiled-binary five-stage research E2E, and artifact
upload. Each compiled-binary E2E completed with 1 pass and 0 fail.

The accepted fork artifacts both report `0.0.0-resagent-9ff32c55d0ad`. Independent downloads and
checksum calculations on Windows matched their `SHA256SUMS`:

```text
b61e60ef5dbd1180cd185741c42e9c184d473048aa74d987c08614ac9229d214  resagent-linux-x64.tar.gz
02754d33eafa65bc2a2a5f43d574dffc98b6231ba40990cd9178a8e2a0573f75  resagent-windows-x64.zip
```

`resagent-linux-x64.tar.gz` is 49,973,500 bytes and contains one mode-`0755` `resagent` binary of
147,224,704 bytes. The extracted binary SHA-256 is
`51714f888a15645908489ccaf97045850905cf3f3c49b54862d8d5a2b27576ba`.
`resagent-windows-x64.zip` is 51,610,679 bytes and contains one executable `resagent.exe` of
142,990,336 bytes. The extracted binary SHA-256 is
`9ef339eb7c0e64be18dd5705a40c0c7813cf808372655c821d58046a4df256b7`, and the independently
extracted Windows binary returned the accepted version locally.

Pre-CI local evidence: `bun typecheck` passes in `packages/opencode`; the Windows x64 compiled
binary and the same binary extracted from its archive both return
`0.0.0-resagent-202607241132` from `resagent --version`.
Manual evidence: `resagent-windows-x64.zip` is 51,883,307 bytes and contains
`resagent.exe` with Unix-compatible executable metadata. `SHA256SUMS` matches an independent
SHA-256 calculation:

```text
5c05a1fa23e079510de8dbdb6897fc692a85b24a94ddfeda55e8f2fd80ee55e4  resagent-windows-x64.zip
```

The compiled `resagent.exe` is 143,405,568 bytes, the archive contains only that member with mode
`0755`, and an independently extracted copy passed the version smoke test.
`packages/opencode/test/cli/release-verifier.test.ts` passes 4 tests covering target naming,
checksum parsing, ZIP member/executable validation, extraction, and exact version execution. With
`RESAGENT_TEST_BINARY` set to the compiled Windows binary,
`packages/opencode/test/cli/research-process.test.ts` passes the complete five-stage workflow,
report export, provenance, progress, and secret-canary assertions.

Native Linux x64 evidence was produced from the same 6,356-file working-tree snapshot on an
explicitly approved `tor-client` host running Ubuntu 20.04 with
`Linux 5.4.0-216-generic x86_64`. The snapshot included only tracked and non-ignored working-tree
files, and its SHA-256 was independently verified before extraction:

```text
9a40c083a96c0e2bda2dba28c576165422e570b9d079cee97de325b4afc4152d  source.tar.gz
```

The host installed the frozen lockfile with user-scoped Bun `1.3.14`, Node `24.18.0`, and the
lockfile's `node-gyp` without modifying the host system. Its 2 GB, no-swap limit killed the remote
`tsgo` process, so that attempt is not counted as typecheck evidence; the same final source passed
`packages/opencode` typecheck locally before the snapshot was created. The host then built
`resagent-linux-x64.tar.gz` and passed the independent release verifier plus the compiled-binary
five-stage research subprocess E2E. The archive is 50,352,650 bytes, contains only a mode-`0755`
`resagent` binary of 148,170,880 bytes, and reports the exact accepted version
`0.0.0-resagent-202607231426`:

```text
5da80fc656fe321f94a295d984715c0e73e20fb96418dd27707d0f4402b758da  resagent-linux-x64.tar.gz
```

The verified Linux archive was transferred back through the approved alias, independently
checksum-verified on Windows, and retained under the ignored `packages/opencode/dist/`
release-output directory. The remote source, runtime, archive upload, and build workspace were
removed after verification.

Cross-build contract: one native dependency installation intentionally supplies only that host's
optional binaries. The release workflow therefore builds one target on each native matrix host
instead of treating a Windows all-target cross-build as release evidence. No dependency or
lockfile version was changed.

Residual risk: tag publication is intentionally deferred until an explicit `resagent-v*` release
tag is created; the accepted non-tag run correctly skipped the publish job. macOS release builds
are intentionally unsupported. The inherited `.github/workflows/publish.yml` remains guarded
OpenCode publication automation; standalone ResAgent release artifacts are produced by the
package build script and are not coupled to the upstream package-manager publication flow.

## 12. Final Verification Snapshot

Run on 2026-07-23:

- Core, OpenCode, TUI, protocol, server, client, SDK JavaScript, and schema typechecks: pass.
- Frozen Windows dependency installation with `@opentui/*` `0.4.5`: pass; `bun.lock` unchanged.
- Core EventV2, research, remote, runner, and real OpenSSH group: 170 pass, 0 fail.
- OpenCode HTTP SDK, OpenAPI, CLI, release verifier, manifest, and subprocess group: 54 pass,
  0 fail.
- OpenCode server partition: 274 pass, 23 skip, 5 fail. The five isolated plugin/listener timeouts
  reproduce unchanged in the pinned upstream worktree on this Windows environment.
- OpenCode CLI partition: 371 pass, 6 skip, 1 fail. The failure is Windows `EPERM` creating a
  symlink without Developer Mode or elevation.
- OpenCode tool/session/plugin/util partition: 1041 pass, 20 skip, 1 todo, 7 fail. The failures are
  one load-sensitive 253 ms versus `<250 ms` assertion, two Windows path-normalization
  expectations, and four Windows symlink privilege failures.
- OpenCode ACP/MCP/project/provider/config/effect/LSP partition: 1098 pass, 2 skip, 5 fail,
  1 error. Four failures plus the error are
  `test/project/instance-bootstrap.test.ts`; its isolated result is 0 pass, 4 fail, 1 error in both
  ResAgent and the pinned upstream worktree. The later VCS failure is a cleanup cascade.
- Remaining OpenCode partitions completed. One EventV2 ownership regression discovered by the
  workspace tests was fixed; `test/event.test.ts` is 46 pass, 0 fail and the workspace/manifest
  rerun is 36 pass, 1 Windows-only skip, 0 fail. The only residual failures in those partitions are
  two Windows snapshot symlink privilege failures.
- The global AppRuntime includes the V2 event, location, Session, local execution, and research
  workflow graph. OpenCode typecheck and the real research CLI subprocess pass with this wiring.
- TUI focused group: 30 pass, 0 fail.
- Client Promise tests: 7 pass, 0 fail.
- Schema manifest tests: 3 pass, 0 fail.
- Research subprocess workflow with secret canary: 1 pass, 0 fail.
- Windows x64 build, ZIP member metadata, checksum, built-in smoke test, and independent extracted
  smoke test: pass.
- Windows compiled-binary five-stage provider E2E: 1 pass, 0 fail.
- Native Linux x64 frozen dependency installation, archive build, executable metadata, checksum,
  exact-version smoke test, independent verifier, and compiled-binary five-stage provider E2E:
  pass. Native typecheck evidence for the final snapshot comes from the local eight-package run
  because the approved 2 GB build host killed `tsgo`.
- Release verifier focused tests: 4 pass, 0 fail.
- Native release workflow: implemented for Linux and Windows, with packaged-binary E2E and tag
  publication. Fork run `30064679805` passed both native jobs for final implementation commit
  `9ff32c55d0adf70fca0d3f89328cc882dd9a191e`.

Post-recovery rerun on 2026-07-23:

- Frozen Bun `1.3.14` hoisted installation: pass; 2,371 packages installed; prepare script pass;
  `bun.lock` unchanged.
- Prettier across 88 formattable changed files, workflow YAML parsing, `git diff --check`, and
  high-confidence secret scanning across 90 changed files: pass.
- Prohibited remote identifiers (`az-*`, the previously used external IP, and retired host
  aliases) are absent from changed files.
- Eight affected package typechecks: pass.
- Core EventV2, research, remote, runner, and local OpenSSH group: 216 pass, 0 fail.
- OpenCode HTTP SDK, OpenAPI, CLI, release verifier, manifest, and subprocess group: 54 pass,
  0 fail.
- TUI focused group: 30 pass, 0 fail; Client Promise tests: 7 pass, 0 fail; Schema manifest tests:
  3 pass, 0 fail.
- Production remote service and canonical `remote_run` acceptance on only `tor-client` and
  `tor-hs`: pass for both hosts.
- Final-source Windows and native Linux rebuilds, exact-version smoke tests, independent archive
  verifiers, combined checksums, and compiled five-stage research E2E: pass.
- Release workflow review on 2026-07-24: `actionlint 1.7.12` with ShellCheck `0.11.0` returned no
  findings; the native Linux/Windows matrix enforces `--frozen-lockfile` and supplies an explicit
  repository context to the tag-publishing job.
- `zizmor 1.28.0` identified template injection in the inherited `setup-bun` action and retained
  checkout credentials in the native jobs. The action now passes install flags through an
  environment-backed argument array, checkout persistence is disabled, and stale non-tag runs
  are cancelled without interrupting tagged releases. The pedantic Zizmor rerun returned no
  findings, and a semicolon-bearing input remained an inert argument sequence.

Fork CI acceptance on 2026-07-24:

- Workflow run `30064679805`, attempt 1, completed successfully for exact commit
  `9ff32c55d0adf70fca0d3f89328cc882dd9a191e`.
- Native Linux job `89393213953`: typecheck, archive build, release verifier, exact-version smoke
  test, compiled-binary five-stage E2E, and artifact upload passed.
- Native Windows job `89393213933`: typecheck, archive build, release verifier, exact-version
  smoke test, compiled-binary five-stage E2E, and artifact upload passed.
- Linux artifact: `resagent-linux-x64.tar.gz`, 49,973,500 bytes,
  SHA-256 `b61e60ef5dbd1180cd185741c42e9c184d473048aa74d987c08614ac9229d214`.
- Windows artifact: `resagent-windows-x64.zip`, 51,610,679 bytes,
  SHA-256 `02754d33eafa65bc2a2a5f43d574dffc98b6231ba40990cd9178a8e2a0573f75`.
- Both extracted binaries reported `0.0.0-resagent-9ff32c55d0ad`; both packaged-binary E2E jobs
  completed with 1 pass and 0 fail.

## 12A. WSL Fresh-User Acceptance

Run on 2026-07-24 against the local WSL2 `podman-machine-default` distribution:

- Environment: Fedora Linux 44 container image, Linux x86_64, UID 1000, with `tar`, `gzip`,
  `sha256sum`, `curl`, OpenSSH, and Python 3 available.
- No SSH connection was attempted. No `tor-*`, `az-*`, or other remote host was contacted.
- Workflow run `30070650302` artifact `resagent-native-linux-X64` was downloaded outside WSL,
  then checksum verification, extraction, installation, configuration, diagnostics, provider
  calls, and report inspection ran inside WSL under `/tmp/resagent-user-c7798222`.
- The artifact checksum matched its `SHA256SUMS` entry:

```text
25d292edd3dfce6ced43290b2eb416a2dc8726db11bbbeb2fa3b2ab906454315  resagent-linux-x64.tar.gz
```

- Installation to the isolated `~/.local/bin` succeeded. The 147,224,704-byte executable
  reported `0.0.0-resagent-c77982222563`.
- `resagent doctor` returned nine `ok` checks for providers, the selected profile, all five
  routes, OpenSSH, and report writability. The only warning was the expected
  `remote hosts: none configured`.
- A loopback-only OpenAI-compatible fixture received exactly five non-title requests. The CLI
  completed plan, collect, analyze, verify, and report, and wrote a 1,126-byte Markdown report
  containing a conclusion, citations, confidence and limitations, and provider provenance.
- A unique environment canary was absent from stdout, stderr, fixture logs, and the report.
- Fresh-user inspection found that `resagent --help` incorrectly rendered command names as
  `opencode`. Root cause: the native build defined `process.env.RESAGENT_DISTRIBUTION`, while the
  branding helper read the value indirectly through a function parameter, preventing Bun's
  compile-time replacement.

Resolution and final rerun:

- Commit `c5e1f6e72711803c6ee4a400ac01e847d291f78e` directly exposes the standalone distribution
  constant to the compiler, removes inherited product names from top-level command summaries,
  and makes the release verifier execute and scan `--help` in addition to checking `--version`.
- Focused branding and release-verifier tests: 6 pass, 0 fail.
- `packages/opencode` typecheck: pass.
- Local Windows x64 native build and archive verifier: pass. The extracted command summary uses
  `resagent` throughout.
- Fork workflow run `30075196356` passed on exact commit
  `c5e1f6e72711803c6ee4a400ac01e847d291f78e`: Linux job `89424302428` and Windows job
  `89424302471` both passed typecheck, native archive build, version and help verification,
  compiled-binary five-stage E2E, and artifact upload.
- The fixed Linux artifact checksum matched:

```text
69c68cb7989bd38b82e5a671ce30a2d124fe40024f4496524dd159024cf10bdb  resagent-linux-x64.tar.gz
```

- A second clean WSL installation under `/tmp/resagent-user-c5e1f6e72` reported
  `0.0.0-resagent-c5e1f6e72711`. Without any branding environment variable,
  `resagent --help` displayed `resagent research` and no `resagent` command summary contained the
  `opencode` product name.
- The final WSL rerun again produced nine `ok` doctor checks, one expected no-remotes warning,
  exactly five provider calls, and a 1,097-byte report with conclusions, citations, confidence,
  limitations, and provenance. The final canary scan passed.
- Both isolated WSL user directories and both Windows artifact-download directories were removed
  after verification.

## 12B. GitHub Actions Acceptance Hygiene

Reviewed on 2026-07-27:

- `ResAgent native release` run `30079227906` passed for exact commit
  `49171024df943ce641989bbb4fdb57b058371638`: native Linux and native Windows succeeded; the
  publish job was correctly skipped for a branch push.
- The red checks visible on that commit were not ResAgent acceptance failures. Scheduled
  `close-issues` run `30240492378` and `close-prs` run `30224410778` executed inherited OpenCode
  maintenance scripts against `anomalyco/opencode` and failed with `403 Forbidden` because the
  fork token cannot modify upstream issues or pull requests.
- Fifteen hourly `beta` runs were queued on an upstream-only Blacksmith runner and required
  OpenCode application credentials and API secrets unavailable to this fork.
- All 26 inherited OpenCode workflows were disabled in `BoringZheng/ResAgent`, all queued
  `beta` runs were cancelled, and `ResAgent native release` remained active as the only supported
  acceptance and release workflow.
- Historical failed or cancelled checks remain attached to their original commit by GitHub.
  Acceptance is determined from the latest `ResAgent native release` run, not inherited workflow
  history.

## 12C. Research Evidence Refactor, Phase A

Verified on 2026-07-27:

Requirement: Evidence is a first-class, durable, machine-checkable artifact of a research run.
Implementation: `packages/core/src/research-evidence.ts` harvests settled tool calls into
identified evidence, `packages/core/src/research-schema.ts` defines one output schema per stage,
`packages/core/src/tool/research-stage.ts` registers one submission tool per stage plus
`research_evidence`, and `packages/core/src/session/runner/llm.ts` selects the active stage's tool
by permission. `SessionEvent.Research` gained `evidence.recorded` and `plan.recorded`; both are
additive.
Automated evidence: 33 pass, 0 fail across `test/research-run.test.ts`,
`test/research-workflow.test.ts`, `test/research-route.test.ts`, `test/research-evidence.test.ts`,
and `test/tool-research-stage.test.ts`. The full `packages/core` suite is 1136 pass, 7 skip, 6 fail,
where every failure is the environmental one recorded below. `packages/opencode` end-to-end coverage
was updated to the tool contract and passes: `test/cli/research-process.test.ts` drives all five
stages through their submission tools, and `test/server/httpapi-sdk.test.ts` is 25 pass, 0 fail
including the five-stage SDK workflow, the conflicting-evidence report, and both provider-route
tests. `bun typecheck` passes in `packages/core` and `packages/opencode`.
Manual evidence: `research-run.test.ts` carries a fold guard that publishes a run containing no new
event type and asserts the entire projection with `toEqual`, so any change to an existing branch's
semantics fails the suite. Prompt construction no longer reads the message history: the plan and the
evidence index are rebuilt from durable events, and the 12k truncated prior-results blob is gone.
A settled submission ends the provider turn, so each stage costs exactly one provider request when
the model complies; `httpapi-sdk.test.ts` still asserts five primary calls for a clean run and seven
for the fallback run. The six research tools register globally and are gated by permission alone, so
`test/location-layer.test.ts` now lists them in the default registry contents.
Residual risk: the loop-back edge, `research_recheck`, resume, and budget enforcement are Phases B
and C and are not yet implemented; a stage that exhausts its correction round still fails the run.

Windows environment baseline for this run:

- `packages/core/test/remote-e2e.test.ts`: 0 pass, 6 fail, on the working tree **and** on a clean
  stashed tree. Every failure is the same fixture-setup error: Windows OpenSSH refuses the generated
  host key because `CodexSandboxUsers` holds an ACL on it, so `sshd` exits with
  `no hostkeys available`. No test body runs. This is an ACL condition of the current machine, not a
  regression; section 10 records 6 pass, 0 fail for the same file on a machine without that ACL.
- The full `packages/opencode` suite is 3201 pass, 58 skip, 1 todo, 21 fail. Exactly one failure was
  caused by this change — `test/event-manifest.test.ts` counted 95 latest wire types where the two
  additive research events make 97 — and it is fixed, with both new type names now asserted by name.
  The other 20 were reproduced on a clean stashed tree by rerunning their twelve files directly:
  `test/cli/acp/config-options.test.ts`, `test/cli/help/help-snapshots.test.ts`,
  `test/cli/tui/editor-context-zed.test.ts`, `test/project/instance-bootstrap.test.ts`,
  `test/server/httpapi-file.test.ts`, `test/session/llm.test.ts`,
  `test/session/snapshot-tool-race.test.ts`, `test/snapshot/snapshot.test.ts`,
  `test/tool/external-directory.test.ts`, `test/tool/truncation.test.ts`,
  `test/util/filesystem.test.ts`, and `test/util/glob.test.ts`. They fall into three groups: symlink
  and Windows path-normalization tests that need privileges this machine does not grant, bootstrap
  and subprocess tests that time out under load, and two unrelated drifts — an OpenAI
  `reasoning.mode` payload expectation and a help-text snapshot still saying
  `attach to a running opencode server`. Membership of the timeout group varies between runs, which
  is itself evidence that those failures are load-dependent rather than deterministic.

## 12D. Research Evidence Refactor, Phase B

Verified on 2026-07-27:

Requirement: Verification can actually verify, and a reported gap can be acted on rather than only
reported.
Implementation: `packages/core/src/tool/research-stage.ts` registers `research_recheck`, allowed by
`packages/core/src/session/runner/llm.ts` to the `verify` stage alone. It takes an evidence
identifier — never a URL, path, or host alias — and `ResearchEvidence.retrieval` is the only mapping
from a stored source back to a tool call, so a prompt cannot name a source the run does not already
hold. The re-run goes through `ToolRegistry.materialize().settle()` by tool name, so a remote
recheck still asks the same `<alias> <command>` permission the collector was granted and the
"a prompt cannot introduce a new hostname" invariant is untouched. This is the second caller of
`materialize()` in `src`; unlike the runner it invokes by name and advertises nothing to a model.
Rechecks are capped per run by `MAX_RECHECKS` (8). `SessionEvent.Research` gained
`stage.reopened`, additive; `packages/core/src/research-run.ts` folds it by returning a completed
stage to `active` and appending a `Reopening` whose `fromAttempt` bounds the current round, and
`packages/core/src/research-workflow.ts` reopens `[collect, the stage that raised the gaps]` once
per run (`MAX_RECOLLECT_ROUNDS`).
Automated evidence: 47 pass, 0 fail across `test/research-run.test.ts`,
`test/research-workflow.test.ts`, `test/research-route.test.ts`, `test/research-evidence.test.ts`,
`test/tool-research-stage.test.ts`, `test/remote.test.ts`, and `test/tool-remote-run.test.ts` — the
last two confirm the remote side did not regress. `test/tool-research-stage.test.ts` registers a
stand-in `webfetch` and asserts that a recheck re-runs it, records a superseding row, and reports
the digest change, and that a recheck outside `verify` is refused. `test/research-run.test.ts`
asserts a reopened stage keeps its position and its flat attempt history, that the previous round's
message can no longer complete it, and that reopening a stage that never completed fails. The full
`packages/core` suite is 1141 pass, 7 skip, 6 fail, where all six failures are the `remote-e2e`
host-key ACL condition recorded under Phase A and none is new; `test/location-layer.test.ts` now
lists seven research tools in the default registry contents.
`packages/opencode`: `test/event-manifest.test.ts` counts 98 latest wire types and asserts
`session.next.research.stage.reopened` by name; `test/cli/research-process.test.ts` passes
unchanged; `test/server/httpapi-sdk.test.ts` is 26 pass, 0 fail, the new case driving a run whose
analysis reports a gap and asserting that the report names the reopening round and its reason and
that the rerun left nothing unmet. `bun typecheck` passes in `packages/core` and
`packages/opencode`.
Manual evidence: the fold guard in `test/research-run.test.ts` still asserts the whole projection of
a stream containing no new event type with `toEqual`, so the append-only constraint remains
executable. `StageStarted`'s once-per-stage rule is untouched — a reopening is its own event type,
never a second start — and `StageCompleted` now scopes its success check to the current round via
`ResearchRun.currentRoundAttempts`, which is the identity function on any stream that predates
`StageReopened`. A reopened round that fails to submit is salvaged onto whatever turn it did
produce, so the earlier round's result stands and the gap stays reported rather than costing the
run its analysis.
Residual risk: a `verify` gap does not rerun `analyze`, so analysis findings can be stale relative
to evidence the second collection round added; this is a deliberate cost tradeoff, and verify rules
against the full evidence index regardless. `MAX_RECOLLECT_ROUNDS` and `MAX_RECHECKS` are module
constants until Phase C makes them configurable. Resume and budget enforcement remain Phase C;
parallel collection remains Phase D. Manual acceptance items 1 and 2 of the refactor plan are still
unexercised against a live provider.

## 12E. Research Evidence Refactor, Phase C

Verified on 2026-07-27:

Requirement: A failed run can be continued rather than restarted, a run's ceilings are stated by
configuration rather than hardcoded, and what a run spent is visible in its report.
Implementation: `packages/core/src/config/research.ts` gained a `budget` section — `max_cost`,
`max_tokens`, `max_tool_calls_per_stage`, `max_recollect_rounds`, `max_rechecks`,
`max_parallel_collectors` — each optional and bounds-checked by its schema.
`packages/core/src/research-budget.ts` resolves them into a `Limits` record, merging per field with
later documents winning, and is registered in `packages/core/src/location-services.ts` as a
location-scoped service; its layer reads `Config.Service` through `Effect.serviceOption`, so
`nodeWithoutConfig` yields the defaults without standing up a Location, following the
`ToolOutputStore` precedent. The hardcoded `Math.min(agent.info?.steps ?? 6, 6)` in
`packages/core/src/session/runner/llm.ts` now reads `ResearchBudget.steps(limits, stage)`, and the
plan stage's reconnaissance ceiling moved there as `reconSteps` so one definition serves both the
runner and the report. `MAX_RECHECKS` and `MAX_RECOLLECT_ROUNDS` are gone: `tool/research-stage.ts`
and `research-workflow.ts` read `maxRechecks` and `maxRecollectRounds` from the service.
`SessionEvent.Research` gained `resumed`, additive; `packages/core/src/research-run.ts` folds it by
returning a `failed` run to `active` while keeping its completed stages, message identifiers, plan,
and evidence, and refuses any other status through `ResumeUnavailableError`. `Info` gained
`startedAt`, derived from the `Started` event the stream already carried rather than from a new one.
`ResearchRun.resume` picks `fromStage` as the first stage without a completed entry, falling back to
`report` when every stage completed. `research-workflow.ts` skips completed stages by rereading
their submitted result from the durable message identifier, never reselects the profile
(`routes.get(started.profile)`), and seeds the recollection count from the durable `collect`
stage's reopenings so the loop budget is spent per run rather than per attempt. Cost and token
ceilings are checked between rounds, so `BudgetExceededError` leaves evidence and completed stages
intact and the run is itself resumable. Usage is read once at attempt start and accumulated per
round thereafter; the report's Provenance section states the run total against its ceilings, each
stage's own spend, and any stage that reached the step ceiling. `packages/opencode`'s
`research` command gained `--resume [runID]` and the opt-in `--review-plan`, which prints the
structured plan and waits; declining raises `PlanRejectedError`. `doctor` reports the six resolved
ceilings.
Automated evidence: 140 pass, 0 fail across `test/research-run.test.ts`,
`test/research-workflow.test.ts`, `test/research-route.test.ts`, `test/research-evidence.test.ts`,
`test/research-budget.test.ts`, `test/tool-research-stage.test.ts`, and `test/session-runner.test.ts`.
`test/research-budget.test.ts` asserts the defaults, per-field merging across documents, schema
rejection of a zero cost and an out-of-range step ceiling, and that the two loop ceilings accept
zero. `test/research-run.test.ts` asserts that resuming refuses when no run exists, when the run is
active, and when the stated identifier names a different run, and that a successful resume reports
the first stage that never completed. `test/session-runner.test.ts` drives its ceiling from a
configured `max_tool_calls_per_stage: 6`, which is what makes it evidence that the runner reads
configuration rather than a constant. `test/research-workflow.test.ts` asserts the per-stage and
run-level usage lines, that a capped stage says so, that the plan stage keeps its own ceiling rather
than the configured one, and that spend is attributed to the first stage whose attempt a turn
precedes, with turns predating `startedAt` excluded and an unsettled round counted toward the total
but toward no stage. The full `packages/core` suite is 1149 pass, 7 skip, 6 fail, where all six
failures are the `remote-e2e` host-key ACL condition recorded under Phase A and none is new.
`packages/opencode`: `test/event-manifest.test.ts` counts 99 latest wire types and asserts
`session.next.research.resumed` by name; `test/server/httpapi-sdk.test.ts` is 26 pass, 0 fail;
`test/cli/research-process.test.ts` passes. `bun typecheck` passes in `packages/core` and
`packages/opencode`.
Manual evidence: the fold guard in `test/research-run.test.ts` still asserts the whole projection of
a stream containing no new event type with `toEqual`; `startedAt` was added to its expectation
without adding an event to its input, which is the check that the new field is derived rather than
recorded. `test/server/httpapi-sdk.test.ts` needs `--timeout 30000` on this machine, but so does
`HEAD` before this refactor: the same file times out on four research cases at the default 5000 ms
without any of Phase A through C applied, and on three with them, so the timeouts are load-dependent
and the read-once usage accounting made them fewer rather than more.
Residual risk: Phase B's residual note that `MAX_RECOLLECT_ROUNDS` and `MAX_RECHECKS` are module
constants is discharged — both are configuration now. Ceilings are checked between rounds, so a
single round may overshoot before the run stops; the ceiling is a bound on what a run continues to
spend, not on what it has spent. `spend()` attributes every turn after `startedAt` to the run, which
would over-count a concurrent non-research turn in the same session; the workflow's
`SessionBusyError` guard makes that unreachable today. The CLI's plan review is approve or decline
only — the `PlanReview` contract carries an edited plan, but no `$EDITOR` round-trip exists in this
repository and adding one is not this phase's work. `max_parallel_collectors` is resolved and
reported but not yet acted on; parallel collection remains Phase D, which §12F discharges. Manual
acceptance items 1 through 4 of the refactor plan — including forcing a report-stage failure to
exercise `--resume`,
and setting `max_tool_calls_per_stage` to 2 to see the cap-out reach provenance — are still
unexercised against a live provider.

## 12F. Research Evidence Refactor, Phase D

Verified on 2026-07-28:

Requirement: Collection can be split across several sessions running at once, without a child ever
becoming a second place a run's state lives, and with the default configuration behaving exactly as
before.
Implementation: `packages/core/src/session.ts`'s `CreateInput` gained `parentID`, passed through to
`SessionV1.SessionInfo.make`; the field and its index already existed in the schema and in
`session/sql.ts`, so nothing was added to the data model. `SessionEvent.Research` gained
`SubcollectionStarted { runID, round, childSessionID, requirementIDs }` and
`SubcollectionSettled { childSessionID, outcome }`, both additive, both durable.
`packages/core/src/research-run.ts` folds them into `Info.subcollections` — one entry per child with
its round, its bucket, and `active` or `settled` — and refuses through `InvalidTransitionError` to
open a subcollection outside an active collect stage, to open a second one for the same child, or to
settle one that is not open. The pure helper `subcollectionStage(run, childSessionID)` returns the
parent's collect stage only while an open entry names that child, and `ResearchRun.borrowed`
resolves the whole grant in one place: it reads `parent_id` from the child's own session row, folds
the parent's stream, and hands back the run, that stage, and the bucket. Both consumers read it —
`session/runner/llm.ts` for the child's tools, model route, and step ceiling, and
`tool/research-stage.ts` for submission acceptance and evidence reads — so the child's authority has
one definition rather than two. `research-workflow.ts` deals the plan's requirements round-robin
into `max_parallel_collectors` buckets, but only on the first collect round and only when the run
has not split before; each bucket gets a child session created with `parentID`, the children run
under `Effect.forEach(..., { concurrency: N })`, and their turns are charged to the parent's budget.
Evidence harvested from a child is recorded against the parent run with `collectedSessionID` naming
the child. A child failure is caught per bucket, settles as `failed`, and leaves the parent to run
the round itself; the parent's prompt gains a "What your subcollectors reported" section, and a
child's prompt gains "Requirements assigned to you". `render()` lists every child in the report's
Provenance section with its round, outcome, and bucket. With `max_parallel_collectors` at its
default of `1` the split is a single bucket, which is the unsplit path.
Automated evidence: 145 pass, 0 fail, 449 expect() calls across `test/research-run.test.ts`,
`test/research-workflow.test.ts`, `test/research-route.test.ts`, `test/research-evidence.test.ts`,
`test/research-budget.test.ts`, `test/tool-research-stage.test.ts`, and `test/session-runner.test.ts`
— 140 before this phase. `test/research-run.test.ts` asserts that a subcollection cannot open before
the collect stage or during the plan stage, that two buckets open cleanly and a duplicate child does
not, that `subcollectionStage` hands the collect stage to a named child and nothing to a stranger,
and that settling — which cannot happen twice — withdraws the stage. `test/tool-research-stage.test.ts`
builds real parent and child sessions rather than stubbing the parent link, and asserts that a
sibling sharing the same `parentID` is refused, that the child is held to its own bucket and not to
the requirement its peer was given, that the parent is still held to the whole plan, and that
settling ends the child's ability to submit. `test/research-workflow.test.ts` asserts that a split
run names each child in provenance, including one whose child failed, and that a run which never
split says nothing about splitting. `packages/opencode`'s `test/server/httpapi-sdk.test.ts` drives a
two-bucket run end to end against the test provider with `max_parallel_collectors: 2`, matching each
reply on the assignment block that opened its turn because the two children race; it asserts both
children succeeded, that provenance names them, and — reading the parent's history back through the
SDK — that both `subcollection.started` events and both `subcollection.settled` events are on the
parent session, which is the check that a child kept no run of its own. That file is 27 pass, 0 fail
(26 before this phase). `test/event-manifest.test.ts` counts 101 latest wire types, 99 before, and
asserts both new names. The full `packages/core` suite is 1152 pass, 7 skip, 7 fail: six are the
`remote-e2e` host-key ACL condition recorded under Phase A, and the seventh, `Npm.add > reifies when
package cache directory exists without the package installed`, is a load-dependent timeout that
passes on its own. `bun typecheck` passes in `packages/core` and `packages/opencode`.
Manual evidence: the fold guard in `test/research-run.test.ts` still asserts the whole projection of
a stream containing no new event type with `toEqual`, now carrying `subcollections: []`, which is the
executable form of the constraint that only additive events were introduced. `test/remote.test.ts`
and `test/tool-remote-run.test.ts` are 9 pass, 0 fail, confirming the remote side did not move.
`test/cli/research-process.test.ts` passes, which is the default-configuration path: it never sets
`max_parallel_collectors`, so it is evidence that the unsplit run is unchanged.
Residual risk: the refactor plan's identified risk is undischarged — a split run raises `remote_run`
permission prompts once per child, because each child asks for its own grants and the plan's
`targets.hosts` are not pre-asserted in the parent before the fan-out. The permission invariant
itself is unweakened: a child goes through the same runner and the same `permission.assert`, and a
prompt still cannot introduce a hostname that is not a configured alias. The mitigation is
documented instead: both `docs/resagent-configuration.md` and `docs/resagent-usage.md` say to leave
`max_parallel_collectors` at `1` for runs that reach remote hosts. Only the first collection round
splits; a reopened round is collected by the parent alone, so a gap that needs wide re-collection
gets no parallelism. Requirements are dealt round-robin with no notion of cost, so one bucket may
carry all the expensive requirements and the round waits on it. A child's turns are charged to the
run's budget, but the ceiling is checked between rounds, so N children may overshoot together where
one would have stopped. Splitting has been exercised against the test provider only, and the manual
acceptance items of the refactor plan remain unexercised against a live one.

## 13. Completion Audit Template

For each checked requirement, record:

```text
Requirement:
Implementation:
Automated evidence:
Manual evidence:
Residual risk:
```

The goal is complete only when every 1.0 requirement has current evidence and the full E2E matrix passes on release artifacts.
