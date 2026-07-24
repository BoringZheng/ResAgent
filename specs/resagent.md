# ResAgent Product and Architecture Specification

Status: Release candidate

Baseline: OpenCode `dev` at `e59ba24b801b41d7bb0cabe868c496c61e8ad8c6`

Last reviewed: 2026-07-24

Documentation authority: user and maintainer procedures live in `README.md`, `SECURITY.md`,
`CONTRIBUTING.md`, and `docs/resagent-*.md`. This specification defines intended product and
architecture behavior; `specs/resagent-acceptance.md` records dated verification evidence.

## 1. Purpose

ResAgent is a terminal-first research agent built as an OpenCode distribution. It keeps OpenCode's provider catalog, session engine, permission model, SDK boundary, and TUI, then adds:

- research-oriented agents and evidence workflows;
- explicit provider routing, health, and fallback behavior;
- safe orchestration of multiple SSH hosts from one session;
- reproducible reports with source and execution provenance;
- release-quality diagnostics and end-to-end acceptance tests.

ResAgent is not an autonomous infrastructure control plane. A user remains responsible for granting tool permissions and for the authority of configured SSH identities.

## 2. Product Principles

1. **Terminal first.** The complete workflow must be usable from the TUI and non-interactive CLI.
2. **Evidence before synthesis.** Claims in a research report must retain source or command provenance.
3. **Explicit execution scope.** Every remote action identifies its target hosts before permission is requested.
4. **Local credentials by default.** Provider credentials stay on the control-plane machine unless a user opts into a future remote-agent mode.
5. **Fail closed.** Unknown hosts, host-key failures, unavailable providers, malformed config, and permission denials do not silently fall back to broader authority.
6. **Upstream-compatible boundaries.** New behavior uses OpenCode config, Location services, canonical tools, permissions, generated SDKs, and TUI plugin slots instead of private cross-package imports.
7. **Inspectable operation.** Routing decisions, remote target selection, failures, retries, and final provenance are visible to the user.

## 3. Personas and Core Workflows

### 3.1 Researcher

The researcher asks a question, selects a research profile, reviews the plan, and receives a report with citations, confidence notes, and an execution appendix.

### 3.2 Infrastructure Investigator

The investigator selects one or more named SSH hosts, runs the same diagnostic safely across them, compares results, and asks the agent to explain differences.

### 3.3 Maintainer

The maintainer configures providers and hosts, verifies connectivity, constrains permissions, and can reproduce failures from diagnostics without exposing secrets.

## 4. Scope

### 4.1 Required for 1.0

- Multiple configured model providers using OpenCode's provider catalog.
- Named provider profiles for research roles.
- Deterministic provider selection and bounded fallback for retryable provider failures.
- Named SSH hosts loaded from config.
- Single-host and multi-host command execution through a canonical tool.
- Per-host concurrency limits, timeouts, cancellation, and bounded output.
- Strict host-key verification by default.
- Permission resources that include both host and command.
- Research workflow with plan, collect, analyze, verify, and report stages.
- Markdown report export with source and remote-execution provenance.
- TUI surfaces for provider state, host state, active targets, and failure details.
- Unit, integration, local-fixture E2E, and compiled-binary native E2E coverage.
- Windows and Linux support for the terminal application.

### 4.2 Deferred

- Password-based SSH authentication.
- macOS release builds and distribution support.
- Copying all local provider credentials to remote hosts.
- A clustered scheduler or durable distributed job queue.
- Running arbitrary long-lived background jobs without owner-bound observation and cancellation.
- Kubernetes, WinRM, cloud-vendor, or proprietary remote transports.
- Treating the permission UI as a security sandbox.

## 5. User Experience Contract

### 5.1 First Run

The first-run flow detects configured providers and the local OpenSSH client. It offers:

- `Provider setup`
- `Remote hosts`
- `Start local research`

No provider key, private key, token, password, or complete authorization header is printed.

### 5.2 Provider Selection

The model picker groups models by provider and displays availability. A research profile may specify:

```jsonc
{
  "research": {
    "profiles": {
      "balanced": {
        "planner": ["anthropic/claude-sonnet", "openai/gpt-5"],
        "collector": ["perplexity/sonar", "openai/gpt-5-mini"],
        "analyst": ["openai/gpt-5", "google/gemini-pro"],
        "verifier": ["anthropic/claude-sonnet"],
        "writer": ["openai/gpt-5"],
      },
    },
  },
}
```

Each ordered list is a route. The first available model is selected. Automatic fallback occurs only for classified retryable failures and never for authentication, policy, invalid-request, or context-loss failures.

### 5.3 Remote Hosts

Hosts are referenced by aliases, never raw connection strings in normal tool calls:

```jsonc
{
  "remotes": {
    "lab-a": {
      "host": "lab-a.example.net",
      "user": "research",
      "port": 22,
      "identity_file": "~/.ssh/id_ed25519",
      "host_key": "strict",
      "tags": ["lab", "linux"],
      "max_concurrency": 2,
    },
  },
}
```

The TUI shows the aliases selected for the current action. A multi-host request has one permission prompt containing all target aliases and the exact command.

### 5.4 Remote Execution Results

Results are stable and machine-readable:

```json
{
  "command": "uname -a",
  "results": [
    {
      "host": "lab-a",
      "status": "ok",
      "exit": 0,
      "duration_ms": 123,
      "stdout": "Linux ...",
      "stderr": "",
      "truncated": false
    }
  ]
}
```

Results preserve input host order. A failure on one host does not discard successful results from other hosts. Cancellation stops in-flight SSH processes and marks unstarted targets as cancelled.

## 6. Architecture

### 6.1 Existing OpenCode Boundaries

ResAgent keeps these boundaries:

- `packages/schema`: wire schemas and identifiers;
- `packages/core`: config, provider catalog, canonical tools, permissions, sessions, and Location services;
- `packages/server`: HTTP API and Location middleware;
- `packages/tui`: SDK-only terminal UI;
- `packages/opencode`: legacy compatibility and distribution host.

The V2 `LocationServiceMap` remains the isolation boundary for project-scoped config, tools, permissions, and filesystem services.

### 6.2 New Modules

The first implementation slice adds:

```text
packages/core/src/config/remote.ts
packages/core/src/remote.ts
packages/core/src/tool/remote-run.ts
packages/core/test/config/remote.test.ts
packages/core/test/remote.test.ts
packages/core/test/tool-remote-run.test.ts
```

Responsibilities:

- `ConfigRemote`: validates declarative host entries.
- `Remote`: resolves aliases, constructs OpenSSH invocations, enforces per-host concurrency, and returns typed results.
- `RemoteRunTool`: owns permission ordering, multi-host orchestration, cancellation, and model-facing output.

The SSH process uses the existing process service. It does not invoke a local shell.

### 6.3 SSH Invocation

The baseline invocation is equivalent to:

```text
ssh
  -T
  -o BatchMode=yes
  -o ClearAllForwardings=yes
  -o ForwardAgent=no
  -o ForwardX11=no
  -o LogLevel=ERROR
  -o PermitLocalCommand=no
  -o PasswordAuthentication=no
  -o ConnectTimeout=<seconds>
  -o StrictHostKeyChecking=yes
  -p <port>
  -i <identity>
  -- <user@host>
  <command>
```

The implementation calls `ChildProcess.make("ssh", args, ...)` directly. It never places the invocation inside a local shell. The remote command is intentionally interpreted by the remote account's login shell.

Optional config may add a known-hosts file or proxy jump. `IdentitiesOnly=yes` is added when `identity_file` is configured. User-supplied OpenSSH options are not accepted in 1.0.

### 6.4 Permissions

The tool action is `remote_run`. Each resource is encoded as:

```text
<host-alias> <command>
```

The tool asks permission before opening any SSH connection. Saved approval remains exact by default. Wildcard approval is possible only through an explicit config rule written by the user.

Permission denial, correction, or cancellation starts no additional hosts.

### 6.5 Provider Routing

Provider routing is layered over the existing provider catalog:

1. Parse configured route entries as `provider/model`.
2. Filter models that are unavailable or policy-disabled.
3. Select the first remaining entry.
4. Record the route and selected model on the stage result.
5. On a retryable provider failure, move to the next route entry if:
   - no tool side effect is pending;
   - the request can be replayed without losing provider-specific state;
   - the stage retry budget is not exhausted.
6. Surface the final failure with all attempted providers.

Fallback is a stage-level policy. It does not modify the global default model.

### 6.6 Research Workflow

A research run is a session-owned workflow:

1. `plan`: produce questions, evidence requirements, and target sources.
2. `collect`: use web, references, local files, and approved remote commands.
3. `analyze`: normalize findings and identify conflicts.
4. `verify`: challenge unsupported or inconsistent claims.
5. `report`: render conclusions, citations, confidence, limitations, and provenance.

The workflow uses ordinary OpenCode messages and canonical tools. Durable provider orchestration stays in the session runner; the workflow must not create a second in-memory agent loop.

### 6.7 Optional Remote Workspace Mode

OpenCode already has an experimental remote `WorkspaceAdapter` target and proxy path. ResAgent may later add an SSH adapter that deploys and forwards a remote sidecar. This mode is deferred until credential scoping, host lifecycle, version negotiation, and recovery are specified and tested.

It must not reuse the current broad `OPENCODE_AUTH_CONTENT` transfer without an allowlist and explicit user consent.

## 7. Configuration

New top-level fields:

```jsonc
{
  "remotes": {
    "lab-a": {
      "host": "lab-a.example.net",
      "user": "research",
      "port": 22,
      "identity_file": "~/.ssh/id_ed25519",
      "known_hosts_file": "~/.ssh/known_hosts",
      "host_key": "strict",
      "connect_timeout": 10,
      "command_timeout": 120000,
      "max_concurrency": 2,
      "tags": ["lab", "linux"],
    },
  },
  "research": {
    "default_profile": "balanced",
    "profiles": {},
  },
}
```

Validation rules:

- aliases match `[A-Za-z][A-Za-z0-9_-]{0,63}`;
- host and user are non-empty and contain no ASCII control characters;
- port is `1..65535`;
- timeouts and concurrency are positive and bounded;
- identity and known-hosts paths support config variable expansion but are never sent to the model;
- `host_key` defaults to `strict`; `accept-new` requires explicit configuration;
- duplicate route entries are rejected during normalization.

Config documents are applied from lowest to highest priority. A later host alias replaces the complete earlier entry for that alias; fields are not partially merged across files. Host inventory is captured when a Location opens, matching existing V2 config lifecycle semantics.

## 8. Observability and Diagnostics

Structured logs include:

- research run and stage identifiers;
- provider route entry and attempt number;
- remote host alias, duration, exit status, timeout, cancellation, and truncation;
- permission request identifier;
- no command output unless debug output logging is explicitly enabled.

`resagent doctor` verifies:

- configured provider and model availability without exposing secrets;
- selected research profile and all five resolved role routes;
- OpenSSH client availability and version;
- host alias resolution plus referenced identity and known-hosts files;
- report-directory writability.

`doctor` does not connect to remote hosts or send a model inference request.

## 9. Compatibility and Upstream Sync

- The fork branch is based on OpenCode `dev`.
- The ResAgent product, default, and release branch is `resagent`.
- New commits use `type(scope): summary`.
- Upstream uses the `origin` remote and the ResAgent repository uses the `fork` remote.
- Syncs are merged or rebased in focused maintenance changes with full package tests.
- Generated SDK files are changed only through repository generation scripts.
- ResAgent-specific branding must state that the project is based on OpenCode and is not maintained by the OpenCode team.

## 10. Definition of Done

1. All required 1.0 behavior is implemented.
2. Unit and integration tests pass in their package directories.
3. E2E tests pass against two independent SSH targets and at least two provider-compatible test servers.
4. TUI workflows pass keyboard-only acceptance on 80x24 and 120x40 terminals.
5. Windows and Linux builds complete.
6. No secret appears in logs, snapshots, test artifacts, or exported diagnostics.
7. A fresh user can complete setup and the primary research workflow using the published documentation.
8. The completion audit in `specs/resagent-acceptance.md` has evidence for every requirement.
9. The root README, governance files, issue templates, and maintained translations describe
   ResAgent rather than inherited OpenCode distribution or support channels.
