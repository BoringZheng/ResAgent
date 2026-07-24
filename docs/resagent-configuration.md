# ResAgent Configuration

ResAgent reads ordinary OpenCode configuration and adds `research` and `remotes`. Existing
provider credentials and provider definitions remain local to the control-plane machine.

## Research Profiles

Each role is an ordered provider/model route:

```jsonc
{
  "research": {
    "default_profile": "balanced",
    "profiles": {
      "balanced": {
        "planner": ["anthropic/claude-sonnet", "openai/gpt-5"],
        "collector": ["openai/gpt-5-mini"],
        "analyst": ["openai/gpt-5"],
        "verifier": ["anthropic/claude-sonnet"],
        "writer": ["openai/gpt-5"],
      },
    },
  },
}
```

Unavailable models are removed from a route. Automatic fallback occurs only before assistant
output or tool side effects and only for classified retryable failures. Authentication, policy,
invalid-request, and context-loss failures do not fall back.

## Remote Hosts

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
}
```

`host_key` defaults to `strict`. Use `accept-new` only when the trust-on-first-use tradeoff is
explicitly acceptable. Password and keyboard-interactive authentication are disabled.

## Permissions

Remote permission resources use the exact form:

```text
<host-alias> <command>
```

All aliases are resolved and the complete request is authorized before any connection starts.
Saved approvals remain exact unless the user writes a broader wildcard policy.

## Reports

Reports default to `.resagent/reports/<run-id>.md` under the active location. An explicit output
path must also remain inside that location.
