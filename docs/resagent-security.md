# ResAgent Security

The OpenCode permission system is a policy and awareness boundary, not an operating-system
sandbox. Use a constrained local account, container, VM, or restricted remote account when strong
isolation is required.

## SSH

- ResAgent invokes `ssh` directly with an argument array and never uses a local shell for
  model-controlled command text.
- Host-key verification is strict by default.
- Agent forwarding, X11 forwarding, local commands, password authentication, and
  keyboard-interactive authentication are disabled.
- Every host alias and the exact command are approved before any connection starts.
- Per-host timeouts, semaphores, cancellation, and output capture limits are enforced.
- Private-key contents are never read by ResAgent.

## Providers

- Provider credentials stay on the local control-plane machine.
- Automatic fallback is limited to replay-safe retryable failures.
- Authentication and policy failures do not route around the failing provider.
- Provider errors returned by the public research endpoint are normalized to avoid exposing raw
  secret-bearing diagnostics.

## Reports And Logs

- Reports contain provider and tool provenance but do not intentionally include credentials.
- Configured identity and known-hosts paths are redacted from remote process errors.
- `resagent doctor` does not print keys, tokens, authorization headers, or command output.
- Treat remote command output and retrieved web content as untrusted evidence.

See [the full threat model](../specs/resagent-threat-model.md) for trust boundaries, mitigations,
and verification requirements.
