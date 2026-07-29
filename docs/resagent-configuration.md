# ResAgent Configuration

ResAgent reads ordinary OpenCode configuration and adds `research` and `remotes`. Existing
provider credentials and provider definitions remain local to the control-plane machine.

The `opencode.json[c]` filenames, `OPENCODE_*` environment variables, schema URL, and internal
package names are retained for compatibility with the inherited configuration loader. They do
not indicate a separate ResAgent installation.

Configuration is loaded at startup. Restart ResAgent after changing a configuration file.

Return to the [documentation index](README.md) for the complete guide map.

## Configuration Locations

Use project-local configuration for research that belongs to one repository or investigation:

```text
./opencode.json
./opencode.jsonc
./.opencode/opencode.json
./.opencode/opencode.jsonc
```

Global configuration is loaded from:

```text
~/.config/opencode/opencode.json
~/.config/opencode/opencode.jsonc
```

On Windows, `~` is the user profile, for example:

```text
C:\Users\<user>\.config\opencode\opencode.jsonc
```

Project configuration overrides global configuration. Existing provider definitions can remain
global while `research` and `remotes` are project-local.

## Provider Setup

Connect providers from the TUI with `/connect`, or use:

```bash
resagent auth login
resagent auth list
resagent models
```

Always populate routes with exact identifiers returned by `resagent models`.

Provider authentication proves that ResAgent can load the provider integration. It does not
guarantee account access to every model. Run `resagent doctor` after defining routes.

## Research Profiles

Each role is an ordered provider/model route:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "research": {
    "default_profile": "balanced",
    "profiles": {
      "balanced": {
        "planner": ["provider-a/model-planner", "provider-b/model-fallback"],
        "collector": ["provider-a/model-fast"],
        "analyst": ["provider-a/model-analysis"],
        "verifier": ["provider-b/model-verifier"],
        "writer": ["provider-a/model-writer"],
      },
    },
  },
}
```

The five required roles are:

| Role        | Responsibility                                     |
| ----------- | -------------------------------------------------- |
| `planner`   | Decompose the question and define evidence needs   |
| `collector` | Gather evidence and invoke approved tools          |
| `analyst`   | Compare evidence and develop candidate conclusions |
| `verifier`  | Challenge claims and qualify conflicting evidence  |
| `writer`    | Produce the final Markdown report                  |

Rules:

- profile names start with a letter and may contain letters, numbers, `_`, and `-`;
- every role has 1 to 16 unique `provider/model` entries;
- the first available entry is attempted first;
- unavailable models are removed when the route is resolved;
- `default_profile` must name a configured profile;
- when there is exactly one profile, it can be selected without a default.

Unavailable models are removed from a route. Automatic fallback occurs only before assistant
output or tool side effects and only for classified retryable failures. Authentication, policy,
invalid-request, and context-loss failures do not fall back.

## Research Budget

`research.budget` states the ceilings a single run may not cross. Every field is optional and an
omitted one takes the default below:

```jsonc
{
  "research": {
    "budget": {
      "max_cost": 5.0,
      "max_tokens": 2000000,
      "max_tool_calls_per_stage": 24,
      "max_recollect_rounds": 1,
      "max_rechecks": 8,
      "max_parallel_collectors": 1,
    },
  },
}
```

| Field                      | Default   | Meaning                                                            |
| -------------------------- | --------- | ------------------------------------------------------------------ |
| `max_cost`                 | `5.0`     | Provider spend, in the catalog's currency, one run may accumulate   |
| `max_tokens`               | `2000000` | Input, output, reasoning, and cache tokens one run may accumulate   |
| `max_tool_calls_per_stage` | `24`      | Provider steps one stage round may take; a step may carry several tool calls |
| `max_recollect_rounds`     | `1`       | Times a run may reopen collection to close reported gaps            |
| `max_rechecks`             | `8`       | Times verification may retrieve an already-recorded source again    |
| `max_parallel_collectors`  | `1`       | Collection sessions that may run at once                            |

Later configuration documents win per field, so a project can raise one ceiling without restating
the rest. `max_recollect_rounds` and `max_rechecks` accept `0`, which turns those loops off.

`max_parallel_collectors` above `1` splits the first collection round. The plan's requirements are
dealt round-robin into that many buckets, each bucket is collected by its own child session, and the
children run concurrently. A child collects only its own bucket and answers for only those
requirements; the evidence it gathers is recorded against the parent run, which stays the only place
a run's state lives. A child that fails costs its bucket, not the run: the parent still runs the
collection round itself with whatever the children reported, and every child is named in the
report's Provenance section with its bucket and its outcome. Later rounds, including reopened
collection, never split.

Raising this multiplies the permission prompts a run can raise, because each child asks for its own
`remote_run` grants. Prefer leaving it at `1` for runs that reach remote hosts.

Cost and token ceilings are checked between stage rounds, never inside one. A run that reaches a
ceiling fails with its evidence and its completed stages intact, so raising the ceiling and running
`resagent research --resume` costs only the round that never ran. The plan stage has its own small
step ceiling for reconnaissance and does not read `max_tool_calls_per_stage`.

Every report's Provenance section states what the run spent in total and per stage, and names any
stage that reached the step ceiling.

## Remote Hosts

ResAgent remote aliases are an allowlist. The model cannot supply an arbitrary hostname.

When an OpenSSH alias already contains the hostname, user, and identity configuration, reference
the alias directly:

```jsonc
{
  "remotes": {
    "research-a": {
      "host": "research-a",
      "host_key": "strict",
      "connect_timeout": 10,
      "command_timeout": 120000,
      "max_concurrency": 1,
      "tags": ["linux", "research"],
    },
  },
}
```

ResAgent always supplies its configured port to OpenSSH. The default is `22`, so an alias that
uses a non-default port must repeat that value in the ResAgent host entry.

Or provide the connection details explicitly:

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

Host fields:

| Field              | Required | Default  | Notes                                          |
| ------------------ | -------- | -------- | ---------------------------------------------- |
| `host`             | yes      |          | Hostname, address, or OpenSSH alias            |
| `user`             | no       | SSH      | Remote account                                 |
| `port`             | no       | `22`     | TCP port from 1 to 65535                       |
| `identity_file`    | no       | SSH      | Private-key path; contents are never read      |
| `known_hosts_file` | no       | SSH      | Alternate known-hosts path                     |
| `host_key`         | no       | `strict` | `strict` or `accept-new`                       |
| `proxy_jump`       | no       |          | OpenSSH jump specification                     |
| `connect_timeout`  | no       | `10`     | Seconds, maximum 60                            |
| `command_timeout`  | no       | `120000` | Milliseconds, maximum 10 minutes               |
| `max_concurrency`  | no       | `1`      | Concurrent commands for this alias, maximum 16 |
| `tags`             | no       | `[]`     | Labels displayed by the TUI                    |

`host_key` defaults to `strict`. Use `accept-new` only when the trust-on-first-use tradeoff is
explicitly acceptable. Password and keyboard-interactive authentication are disabled.

Run `resagent doctor` after configuration. It validates aliases and referenced local files but
does not connect to remote hosts.

## Permissions

Remote permission resources use the exact form:

```text
<host-alias> <command>
```

All aliases are resolved and the complete request is authorized before any connection starts.
Saved approvals remain exact unless the user writes a broader wildcard policy.

Example resources for one command on two hosts:

```text
research-a uname -a
research-b uname -a
```

Rejecting any required resource prevents the whole request from starting SSH processes.

## Reports

Reports default to `.resagent/reports/<run-id>.md` under the active location. An explicit output
path must also remain inside that location.

## Complete Minimal Configuration

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "research": {
    "default_profile": "balanced",
    "profiles": {
      "balanced": {
        "planner": ["provider/model-planner"],
        "collector": ["provider/model-fast"],
        "analyst": ["provider/model-analysis"],
        "verifier": ["provider/model-analysis"],
        "writer": ["provider/model-writer"],
      },
    },
  },
  "remotes": {
    "research-a": {
      "host": "research-a",
      "host_key": "strict",
      "connect_timeout": 10,
      "command_timeout": 120000,
      "max_concurrency": 1,
      "tags": ["linux"],
    },
  },
}
```

Remove `remotes` entirely for local-only research.

See the [security guide](resagent-security.md) before enabling remote execution and the
[usage guide](resagent-usage.md) for permission and result behavior.
