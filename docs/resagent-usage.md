# ResAgent Usage

Run ResAgent from the directory that owns the investigation. The current directory determines
which project configuration, sessions, remote inventory, and report paths are used.

## Command Summary

```text
resagent                         Open the terminal UI
resagent doctor                  Validate providers, routes, SSH, and reports
resagent models                  List exact provider/model identifiers
resagent auth login              Connect a provider
resagent auth list               List stored provider credentials
resagent research <question>     Run the five-stage research workflow
```

The distribution is named ResAgent, but some inherited OpenCode help text or internal paths may
still use the `opencode` name. Invoke the installed executable as `resagent`.

## Research From The CLI

Run with the default profile:

```bash
resagent research "What is the strongest conclusion supported by the evidence?"
```

Select a profile:

```bash
resagent research --profile deep "Investigate the failure and verify competing explanations."
```

Write the report to a predictable project-relative path:

```bash
resagent research \
  --output .resagent/reports/incident-42.md \
  "Prepare the final incident analysis."
```

The output path must stay inside the current directory.

### Use Standard Input

Question text can come from standard input:

```bash
cat investigation.md | resagent research
```

PowerShell:

```powershell
Get-Content .\investigation.md -Raw | resagent research
```

Positional text and standard input are joined, so a short instruction can accompany a larger
document:

```powershell
Get-Content .\evidence.md -Raw |
  resagent research "Use the attached evidence and call out unsupported claims."
```

### Continue A Session

Continue the newest session in the current directory:

```bash
resagent research --continue "Incorporate the new evidence."
```

Continue an exact session:

```bash
resagent research --session ses_... "Answer the follow-up."
```

`--continue` and `--session` cannot be used together. A session is bound to the directory where it
was created.

## Research In The TUI

Start the TUI:

```bash
resagent
```

The main workflow is:

1. use `/connect` when no provider is configured;
2. create or open a session;
3. press `Ctrl+P`;
4. choose `Start research`;
5. choose a profile when more than one is configured;
6. enter the research question;
7. follow stage, provider, and remote activity in the session and sidebars;
8. open the report path shown by the completion notification.

Use `Start research with report path` when a stable filename is required.

## Remote Execution

Remote execution is exposed to the model through the `remote_run` tool. It accepts:

```json
{
  "hosts": ["research-a", "research-b"],
  "command": "uname -a",
  "timeout": 120000,
  "concurrency": 2
}
```

Users normally do not write this JSON. Use one of these flows:

- In the TUI, press `Ctrl+P`, choose `Remote hosts`, select aliases, and enter the command.
- In a research question, explicitly name configured aliases and ask the agent to use
  `remote_run`.

Example:

```text
Use remote_run to collect uname -a and systemctl --failed from research-a and research-b.
Compare the results and record host-specific failures.
```

The tool preserves requested host order and returns one result per host:

```text
host
status: ok | failed | timeout
exit code
duration
stdout
stderr
truncated
```

A failure on one host does not discard successful results from other hosts.

### Permission Behavior

Every alias and exact command is authorized before any SSH process starts:

```text
research-a uname -a
research-b uname -a
```

Saved approvals are exact unless the user deliberately creates a broader wildcard policy. Treat
wildcards as privileged configuration.

### Remote Limits

- At least one host is required.
- Duplicate aliases are rejected.
- One call may target at most 32 hosts.
- Requested concurrency may not exceed 16.
- Per-host command timeout may not exceed 10 minutes.
- Captured stdout and stderr are bounded; the result reports truncation.
- Password and keyboard-interactive authentication are disabled.
- Agent forwarding, X11 forwarding, and SSH forwarding are disabled.

## Reports

The default report path is:

```text
.resagent/reports/<run-id>.md
```

Reports include:

- the final answer;
- stage outcomes;
- provider-attempt provenance;
- relevant tool and remote evidence;
- qualified conclusions when evidence conflicts.

Reports are ordinary Markdown files. They can be reviewed, versioned, or moved after the run.

## Profiles

Profiles are named routing policies, not agents. Each profile maps the five research roles to an
ordered list of provider/model candidates:

```jsonc
{
  "research": {
    "default_profile": "fast",
    "profiles": {
      "fast": {
        "planner": ["provider/fast-model"],
        "collector": ["provider/fast-model"],
        "analyst": ["provider/analysis-model"],
        "verifier": ["provider/analysis-model"],
        "writer": ["provider/fast-model"],
      },
      "deep": {
        "planner": ["provider-a/model-a", "provider-b/model-b"],
        "collector": ["provider-a/model-fast"],
        "analyst": ["provider-a/model-deep", "provider-b/model-deep"],
        "verifier": ["provider-b/model-deep"],
        "writer": ["provider-a/model-deep"],
      },
    },
  },
}
```

Use `resagent research --profile deep ...` to override the default for one run.

## Operational Checklist

Before a consequential investigation:

1. run `resagent doctor`;
2. confirm `resagent models` still lists every routed model;
3. confirm the current directory contains the intended configuration;
4. verify SSH aliases independently when remote execution is required;
5. keep `host_key` set to `strict`;
6. review each exact remote permission;
7. treat remote output and retrieved content as untrusted evidence;
8. inspect the generated report before using its conclusion.

## Troubleshooting

### No research profile was selected

Add `research.default_profile`, or configure exactly one profile. Restart ResAgent after editing
configuration.

### A route has no available models

Run `resagent models` and replace unavailable route entries with exact listed identifiers. A
credential alone does not guarantee every provider model is enabled.

### Remote hosts are not configured

This is a warning for local-only research. Add the top-level `remotes` object only when remote
execution is needed.

### Identity or known-hosts file is missing

Fix the path in `identity_file` or `known_hosts_file`. `~` is expanded against the local user's
home directory.

### Strict host-key verification failed

Verify the host out of band and update the local known-hosts file. Do not switch to `accept-new`
just to bypass an unexpected key change.

### Report path was rejected

Use a path under the directory where ResAgent was started. Parent traversal and external absolute
paths are rejected.

### `node bin/resagent` fails in a source checkout

Source mode is a Bun entrypoint:

```powershell
$env:RESAGENT_LAUNCH = "1"
bun run src\index.ts doctor
```

Use `resagent.exe` directly for an extracted Windows native artifact.

### Doctor succeeds but a provider call fails

`doctor` verifies inventory and route resolution; it does not send a billable model request.
Check authentication, account policy, rate limits, endpoint configuration, and provider status.

## Related Documentation

- [Quickstart](resagent-quickstart.md)
- [Configuration](resagent-configuration.md)
- [Installation](resagent-installation.md)
- [Security](resagent-security.md)
