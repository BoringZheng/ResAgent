# ResAgent Security Policy

ResAgent coordinates model providers, local tools, reports, and optional SSH commands. A
vulnerability may therefore expose credentials, source code, research data, remote systems, or
release artifacts. Report security issues privately.

## Supported Versions

Security fixes are applied to the current `resagent` branch and, after stable releases exist, to
the newest supported release line. Development snapshots and expired CI artifacts do not receive
backports.

macOS is not a supported platform.

## Report A Vulnerability

Use this repository's private GitHub Security Advisory form:

<https://github.com/BoringZheng/ResAgent/security/advisories/new>

Do not include a vulnerability, exploit, secret, private key, provider token, private hostname,
or sensitive command output in a public issue, discussion, or pull request.

Include:

- affected commit or release;
- Windows or Linux version and installation method;
- minimal reproduction steps;
- expected and observed security boundary;
- impact and required attacker capabilities;
- logs or configuration with all secrets and private connection details removed;
- a proposed mitigation, when available.

Maintainers will acknowledge actionable reports when possible, validate the impact, coordinate a
fix, and publish an advisory when users need to take action. Do not test against systems or
accounts you do not own or have explicit permission to assess.

## Security Model

### No Sandbox

ResAgent's permission system is a policy and awareness mechanism. It is not an operating-system
sandbox and does not make approved commands safe. The local process can access resources granted
to its operating-system account.

Use a dedicated account, container, or VM when strong local isolation is required. Use restricted
remote accounts with the minimum filesystem, process, and network privileges needed for the
investigation.

### Model Providers

Prompts, selected context, and tool results may be sent to configured providers. Provider data
handling is governed by each provider's terms and the user's configuration.

Provider credentials stay on the local control-plane machine for the current ResAgent workflow.
They must not appear in model-visible tool schemas, reports, diagnostics, logs, or remote
environments. Automatic route fallback does not bypass authentication, policy, invalid-request,
or context-loss failures.

### SSH

Remote execution accepts configured aliases, not arbitrary model-supplied destinations. ResAgent:

- constructs an OpenSSH argument array without a local shell;
- uses batch mode and disables password and keyboard-interactive authentication;
- disables agent, X11, local, and TCP forwarding;
- uses strict host-key checking by default;
- authorizes every exact `<host-alias> <command>` resource before connecting;
- applies per-host concurrency, timeout, cancellation, and output limits;
- never reads SSH private-key contents.

The remote account's login shell interprets the approved command. Approval means the user accepts
that command's effects on that host. A compromised remote host may return hostile output; treat it
as untrusted evidence.

### Server Mode

Inherited `serve`, `web`, and attach modes expose powerful APIs. They are optional and are not
required for the normal local research workflow. Set `OPENCODE_SERVER_PASSWORD`, bind to an
appropriate interface, and place internet-facing deployments behind a trusted authenticated
proxy. An intentionally exposed unauthenticated server is outside the supported security model.

### Configuration And Extensions

Project configuration, repository instructions, plugins, MCP servers, skills, and retrieved web
content are inputs to the agent. Review untrusted repositories before starting ResAgent in them.
External plugins, MCP servers, providers, and remote hosts have their own trust boundaries and may
receive or return sensitive data.

### Reports And Logs

Reports preserve provenance and may contain source text or remote output. They are not guaranteed
to be public-safe. Review reports before sharing or committing them. Diagnostics redact known
credential and SSH path material, but users must still avoid supplying secrets in prompts or
commands.

### Release Integrity

Install only archives from this repository's release page or a known workflow run. Verify the
archive against `SHA256SUMS` before execution. Release jobs build Windows and Linux artifacts on
native runners, verify archive structure and version output, and run the five-stage E2E through
the compiled binary.

## Out Of Scope

The following are not security vulnerabilities by themselves:

- harmful behavior from a command the user knowingly approved on the named host;
- access already granted to the local or remote operating-system account;
- data intentionally sent to a configured provider, plugin, MCP server, or remote host;
- sandbox escape claims when no operating-system sandbox is deployed;
- denial of service caused solely by unsupported platforms or configurations;
- an unauthenticated server intentionally exposed despite the documented warning;
- malicious changes made by a user who already controls the configuration or installation.

The complete design assumptions and mitigations are maintained in the
[ResAgent threat model](specs/resagent-threat-model.md).
