# ResAgent Security

This guide explains how to operate ResAgent within its intended trust boundaries. Vulnerabilities
must be reported through the root [security policy](../SECURITY.md), not through a public issue.
The detailed design analysis is in the [threat model](../specs/resagent-threat-model.md).

The permission system is a policy and awareness boundary, not an operating-system sandbox. Use a
constrained local account, container, VM, or restricted remote account when strong isolation is
required.

## Recommended Deployment

- Run ResAgent under a dedicated local account for sensitive investigations.
- Keep project configuration under review and avoid starting in an untrusted repository.
- Configure only the provider accounts and remote aliases needed for the investigation.
- Prefer project-local research profiles and narrowly scoped remote inventory.
- Keep SSH host-key checking at `strict`.
- Review every exact remote permission and generated report.
- Store reports outside public repositories when they contain private source or command output.
- Pin a release tag or commit for repeatable use and verify native archive checksums.

## SSH Boundary

ResAgent accepts named aliases from configuration. The model cannot supply an arbitrary
destination. Before connecting, `remote_run` resolves all aliases and requests permission for
each exact resource:

```text
<host-alias> <exact-command>
```

Rejecting one required resource prevents the request from opening any SSH connection.

The implementation:

- invokes `ssh` directly with an argument array and does not place model-controlled input in a
  local shell;
- enables batch mode and disables password and keyboard-interactive authentication;
- disables agent, X11, local, and TCP forwarding;
- uses strict host-key verification unless `accept-new` was explicitly configured;
- enforces per-host concurrency, command timeout, cancellation, and capture limits;
- never reads private-key contents;
- redacts configured identity and known-hosts paths from process errors.

The approved command is interpreted by the remote account's login shell. Exact permission does
not make the command harmless. Restrict the remote account and inspect the command before
approval.

Use `accept-new` only when trust on first use is an explicit operational decision. An unexpected
key change under `strict` should be investigated out of band rather than bypassed.

## Provider Boundary

Provider credentials stay on the local control-plane machine. They are not copied to remote
hosts by the research workflow.

Prompts, selected context, and tool results may be sent to the selected provider. Configure
providers according to the sensitivity and residency requirements of the investigation.
Automatic fallback is limited to replay-safe retryable failures before assistant output or tool
side effects. Authentication, policy, invalid-request, and context-loss failures do not route
around the failing provider.

`doctor` verifies provider and model inventory but does not send a billable inference request.
A successful check therefore does not prove current quota, endpoint availability, or account
policy.

## Untrusted Evidence

Remote output, web pages, local files, MCP results, plugin output, and repository instructions
may contain prompt injection or fabricated claims. The verification stage challenges evidence,
but it cannot guarantee correctness.

- Prefer primary evidence.
- Compare independent sources.
- Keep host-specific results separate.
- Treat partial remote failure as partial evidence, not success.
- Review citations, confidence, limitations, and provenance in the final report.
- Do not execute commands suggested by retrieved content without understanding their effects.

## Reports And Logs

Reports intentionally preserve useful source and execution provenance. They may contain private
source text, filenames, provider responses, or remote command output even when credentials are
redacted.

- Review reports before sharing, committing, or attaching them to an issue.
- Do not place secrets in prompts or command strings.
- Keep `.resagent/reports` out of public version control when investigations are sensitive.
- Delete obsolete reports according to the project's retention policy.
- Treat terminal captures and CI artifacts as potentially sensitive.

## Server And Extension Surfaces

Normal local research does not require server mode. When using inherited `serve`, `web`, or
attach functionality, set `OPENCODE_SERVER_PASSWORD`, bind intentionally, and use an authenticated
proxy for network exposure.

Plugins, MCP servers, skills, and provider integrations are separate trust boundaries. Review
their code and configuration before granting access. ResAgent cannot secure a compromised
provider, extension, remote host, or operating-system account.

## Release Integrity

Use native archives from this repository's release page or a known successful workflow run.
Verify `SHA256SUMS` before extracting. Branch artifacts expire and are intended for testing;
tagged releases are the durable channel.

The native workflow builds on Windows and Linux runners, verifies archive contents and version
output, and executes the full five-stage workflow through each compiled binary. macOS artifacts
are not produced.

Return to the [documentation index](README.md) for related guides.
