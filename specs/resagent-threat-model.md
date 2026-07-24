# ResAgent Threat Model

Status: Release candidate

Last reviewed: 2026-07-24

## 1. Trust Boundaries

1. The local ResAgent process and its operating-system account.
2. Configured model providers.
3. Web pages and retrieved research content.
4. SSH transport and host-key database.
5. Each configured remote host and its operating-system account.
6. MCP servers, plugins, skills, and repository-local instructions.
7. The terminal user approving or denying actions.
8. GitHub Actions runners, action inputs, caches, and release artifacts.

The OpenCode permission system is an awareness and policy mechanism, not a sandbox. Strong isolation requires a container, VM, or separately constrained remote account.

## 2. Protected Assets

- provider API keys and OAuth tokens;
- SSH private keys, agents, certificates, and known-hosts data;
- local and remote source code and research data;
- command output that may contain secrets;
- report integrity and provenance;
- release binaries, archives, and checksum manifests;
- user-approved target scope;
- session history and permission decisions.

## 3. Security Invariants

1. Provider credentials are never included in model-visible tool definitions or tool output.
2. SSH private-key contents are never read by ResAgent.
3. The remote tool calls the OpenSSH executable with an argument array and never invokes a local shell with model-controlled input.
4. Host-key checking is strict unless the user explicitly configures `accept-new`.
5. Every remote command is authorized against every target alias before execution starts.
6. A configured alias resolves to one immutable host definition for the lifetime of a Location.
7. A command cannot add arbitrary local OpenSSH options.
8. Output limits apply independently per host and again at the generic tool boundary.
9. Cancellation terminates local SSH client processes.
10. Diagnostics redact authorization data, environment secrets, identity paths, and command output by default.
11. Release workflows pin third-party actions, do not persist checkout credentials, and never insert action inputs directly into shell source.
12. Only the tag-publishing job receives `contents: write`; build and verification jobs remain read-only.

## 4. Threats and Mitigations

| Threat                                           | Mitigation                                                                                    | Verification                         |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------ |
| Prompt injection requests broad remote access    | Exact host-plus-command permission resources; no implicit wildcard                            | Permission integration tests         |
| Local shell injection                            | Spawn `ssh` directly with an argument array                                                   | Unit test with metacharacters        |
| SSH option injection through host or user        | Strict config validation; insert `--` before destination                                      | Config and invocation tests          |
| Man-in-the-middle host substitution              | `StrictHostKeyChecking=yes` by default                                                        | E2E host-key mismatch test           |
| Credential leakage to remote                     | Local provider execution for 1.0; no auth-content transfer                                    | Static scan and E2E environment test |
| Credential leakage to logs/model                 | Structured redaction and no output logging by default                                         | Snapshot and diagnostics tests       |
| One slow host blocks all hosts                   | Bounded concurrency and independent timeout                                                   | Multi-host timeout E2E               |
| Partial failure is mistaken for success          | Per-host typed status plus aggregate summary                                                  | Tool output tests                    |
| Unlimited command output exhausts memory         | Per-process capture limit and ToolOutputStore bound                                           | Large-output E2E                     |
| Permission saved for one host applies to another | Resource includes alias and command                                                           | Permission tests                     |
| Host alias changes during a run                  | Config is captured when Location opens                                                        | Location lifecycle test              |
| Malicious remote output injects instructions     | Remote output is marked as tool data; verification stage must treat it as untrusted evidence  | Research workflow tests              |
| Compromised remote host pivots to local machine  | Clear forwarding; disable agent forwarding, X11 forwarding, and local commands; batch mode    | Invocation snapshot                  |
| Remote command outlives cancellation             | Process group termination and bounded kill grace                                              | Cancellation E2E                     |
| Provider fallback duplicates side effects        | Fallback only at safe stage boundaries without pending tool effects                           | Routing state-machine tests          |
| Untrusted repository config grants access        | User-global policy remains able to deny project rules; documentation warns about config trust | Config precedence tests              |
| Action input injects release-runner shell code   | Pass input through an environment variable and split it into an argument array                | ShellCheck and injection test        |
| Checkout token leaks through uploaded artifacts  | Disable checkout credential persistence before building or uploading                          | Zizmor workflow audit                |
| Stale branch run publishes obsolete evidence     | Cancel superseded non-tag runs while tagged release runs remain non-cancellable               | Workflow semantic review             |
| Release job writes outside the intended repo     | Bind `GH_REPO` to `github.repository`; grant write permission only to the publish job         | Workflow semantic review             |

## 5. Explicit Non-Goals

- Preventing a user-approved command from doing harmful work on the remote host.
- Sandboxing the local ResAgent process.
- Securing a provider, MCP server, plugin, or remote host that is already compromised.
- Protecting data intentionally sent to a configured provider.
- Password management in 1.0.

## 6. Security Review Gate

Before enabling remote execution by default:

- invocation construction has focused tests on all supported operating systems;
- strict host-key behavior is proven against a disposable SSH server;
- secret scans cover logs and E2E artifacts;
- permission denial is proven to create zero network connections;
- cancellation is proven to terminate an in-flight remote process;
- the report provenance format cannot confuse command output with citations;
- release workflows pass Actionlint, ShellCheck, and Zizmor with no findings;
- release installation uses the frozen lockfile and checkout credentials are not persisted;
- the optional remote workspace mode remains disabled.
