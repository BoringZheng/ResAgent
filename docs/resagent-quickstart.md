# ResAgent Quickstart

This guide takes a new installation from zero configuration to a completed research report.
ResAgent supports Windows x64 and Linux x64. macOS builds are not supported.

## 1. Choose How To Run ResAgent

Use a native artifact for normal use. Use the source checkout when developing ResAgent or when no
tagged release is available yet.

### Download A Verified CI Artifact

Tagged releases are the preferred distribution channel. Before the first tagged release, or when
testing the `resagent` branch, authenticated GitHub CLI users can download the newest successful
workflow artifact. Branch artifacts are retained for 14 days.

Windows PowerShell:

```powershell
gh auth status
$run = gh run list `
  --repo BoringZheng/ResAgent `
  --workflow resagent-release.yml `
  --branch resagent `
  --status success `
  --limit 1 `
  --json databaseId `
  --jq '.[0].databaseId'

gh run download $run `
  --repo BoringZheng/ResAgent `
  --name resagent-native-windows-X64 `
  --dir .\resagent-download

Set-Location .\resagent-download
```

Linux:

```bash
gh auth status
run="$(
  gh run list \
    --repo BoringZheng/ResAgent \
    --workflow resagent-release.yml \
    --branch resagent \
    --status success \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId'
)"

gh run download "$run" \
  --repo BoringZheng/ResAgent \
  --name resagent-native-linux-X64 \
  --dir ./resagent-download

cd ./resagent-download
```

The download contains the native archive and its `SHA256SUMS`.

### Native Windows Artifact

After downloading `resagent-windows-x64.zip`, verify it against the accompanying `SHA256SUMS`,
then extract `resagent.exe` into a directory on `PATH`.

```powershell
$expected = (
  Select-String .\SHA256SUMS -Pattern ' resagent-windows-x64\.zip$'
).Line.Split()[0].ToLowerInvariant()
$actual = (
  Get-FileHash .\resagent-windows-x64.zip -Algorithm SHA256
).Hash.ToLowerInvariant()
if ($actual -ne $expected) {
  throw "Checksum mismatch for resagent-windows-x64.zip"
}

$install = "$HOME\.local\bin"
New-Item -ItemType Directory -Path $install -Force | Out-Null
Expand-Archive .\resagent-windows-x64.zip -DestinationPath $install -Force
$env:PATH = "$install;$env:PATH"

resagent --version
```

The `PATH` assignment above applies to the current PowerShell session. Add
`%USERPROFILE%\.local\bin` to the user `PATH` for future terminals.

### Native Linux Artifact

```bash
grep ' resagent-linux-x64.tar.gz$' SHA256SUMS | sha256sum -c -
mkdir -p "$HOME/.local/bin"
tar -xzf resagent-linux-x64.tar.gz -C "$HOME/.local/bin"
export PATH="$HOME/.local/bin:$PATH"

resagent --version
```

Add `~/.local/bin` to the shell profile for future terminals.

### Source Checkout

ResAgent requires Bun `1.3.14`.

```powershell
git clone --branch resagent --single-branch https://github.com/BoringZheng/ResAgent.git
cd ResAgent
bun install --frozen-lockfile --linker hoisted
cd packages\opencode

$env:RESAGENT_LAUNCH = "1"
bun run src\index.ts --version
```

Source mode prints `local` as its version because it is not a packaged release.

On Linux:

```bash
git clone --branch resagent --single-branch https://github.com/BoringZheng/ResAgent.git
cd ResAgent
bun install --frozen-lockfile
cd packages/opencode

RESAGENT_LAUNCH=1 bun run src/index.ts --version
```

Do not run `node bin/resagent` from the source checkout. That package launcher is for an installed
binary layout, while source mode uses Bun and `src/index.ts`.

The remaining examples use the installed `resagent` command. In source mode, run the same
subcommand after `bun run src\index.ts`. For example:

```powershell
$env:RESAGENT_LAUNCH = "1"
bun run src\index.ts doctor
bun run src\index.ts research "Question"
```

## 2. Connect A Provider

The terminal UI provides the simplest provider setup:

```powershell
resagent
```

Enter `/connect`, choose a provider, and complete its API-key or OAuth flow. Close the TUI when the
provider is connected.

The equivalent CLI commands are:

```powershell
resagent auth login
resagent auth list
resagent models
```

`resagent models` prints the exact `provider/model` identifiers accepted by research profiles.
Do not guess model IDs from marketing names.

## 3. Create A Research Profile

Create `opencode.jsonc` in the directory where research will run. Project-local configuration is
recommended because reports and sessions are location-scoped.

Replace the example model IDs with values returned by `resagent models`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "research": {
    "default_profile": "balanced",
    "profiles": {
      "balanced": {
        "planner": ["provider/model-planner"],
        "collector": ["provider/model-fast"],
        "analyst": ["provider/model-analyst"],
        "verifier": ["provider/model-verifier"],
        "writer": ["provider/model-writer"],
      },
    },
  },
}
```

Every role must contain at least one available model. Add more models to a role to define an
ordered fallback route:

```jsonc
"analyst": ["provider-a/model-a", "provider-b/model-b"]
```

ResAgent only falls back for retryable failures before assistant output or tool side effects.
Authentication, policy, invalid-request, and context-loss failures stop instead of routing around
the error.

## 4. Run The Preflight Check

Run the check from the same directory that contains `opencode.jsonc`:

```powershell
resagent doctor
```

A local-only setup is ready when these checks are `ok`:

```text
providers
research profile
route planner
route collector
route analyst
route verifier
route writer
OpenSSH
report directory
```

`remote hosts: none configured` is only a warning when remote execution is not needed.

## 5. Run The First Research Job

```powershell
resagent research "Compare the available evidence and identify unresolved contradictions."
```

The workflow runs five durable stages:

1. plan;
2. collect;
3. analyze;
4. verify;
5. report.

The terminal prints stage and provider progress. The final Markdown report is written under:

```text
.resagent/reports/<run-id>.md
```

Choose an explicit path inside the current directory with:

```powershell
resagent research `
  --profile balanced `
  --output .resagent/reports/first-report.md `
  "Investigate the question and produce a sourced conclusion."
```

## 6. Continue A Research Session

Reuse the newest session in the current directory:

```powershell
resagent research --continue "Re-evaluate the conclusion using the new evidence."
```

Or continue a specific session:

```powershell
resagent research --session <session-id> "Answer the follow-up question."
```

Sessions cannot be continued from a different project directory.

## 7. Add Remote Hosts

Remote execution is optional. ResAgent only accepts named hosts from configuration; a prompt
cannot introduce an arbitrary hostname.

If OpenSSH already has working aliases in `~/.ssh/config`, reference those aliases:

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
    "research-b": {
      "host": "research-b",
      "host_key": "strict",
      "connect_timeout": 10,
      "command_timeout": 120000,
      "max_concurrency": 1,
      "tags": ["linux", "verification"],
    },
  },
}
```

ResAgent always supplies the configured port to OpenSSH and defaults it to `22`. When an SSH alias
uses another port, set the same `port` explicitly in the ResAgent host entry.

If the SSH alias does not carry identity or user settings, configure them explicitly:

```jsonc
"research-a": {
  "host": "server.example.net",
  "user": "research",
  "port": 22,
  "identity_file": "~/.ssh/id_ed25519",
  "known_hosts_file": "~/.ssh/known_hosts",
  "host_key": "strict"
}
```

Restart ResAgent after changing configuration, then run:

```powershell
resagent doctor
```

`doctor` validates configuration and referenced files. It does not connect to the remote hosts.

## 8. Use Research And Remote Commands In The TUI

Start the TUI from the project directory:

```powershell
resagent
```

Create or open a session, then press `Ctrl+P` to open the command palette:

- `Start research` asks for a profile and research question.
- `Start research with report path` also asks where to write the report.
- `Remote hosts` selects one or more configured aliases, then asks for the exact command.

Before `remote_run` connects, ResAgent asks for permission using this resource format:

```text
<host-alias> <exact-command>
```

Approve only the command and hosts you intend to run. Rejecting the permission starts zero SSH
connections.

## Next Reading

- [Daily CLI and TUI usage](resagent-usage.md)
- [Complete configuration reference](resagent-configuration.md)
- [Installation and release artifacts](resagent-installation.md)
- [Security model](resagent-security.md)
- [Migrating from OpenCode](resagent-migration.md)
