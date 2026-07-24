# ResAgent Installation

For a complete first run after installation, continue with the
[ResAgent quickstart](resagent-quickstart.md).

Return to the [documentation index](README.md) for the complete guide map.

## Prerequisites

- Bun `1.3.14`
- Git
- OpenSSH client (`ssh`) for `doctor` and remote execution
- A model provider available through ResAgent's inherited provider catalog

Native artifacts do not require Bun or Git at runtime. Source installations require all listed
prerequisites.

## Supported Platforms

| Platform    | Native artifact             | Source development |
| ----------- | --------------------------- | ------------------ |
| Windows x64 | `resagent-windows-x64.zip`  | Supported          |
| Linux x64   | `resagent-linux-x64.tar.gz` | Supported          |
| macOS       | Not produced or supported   | Out of scope       |

## Obtain An Artifact

Tagged releases from this repository publish both native archives and a combined `SHA256SUMS`.
Use the [release page](https://github.com/BoringZheng/ResAgent/releases) when a suitable tagged
version is available.

Before a tagged release exists, authenticated GitHub CLI users can download a successful branch
artifact. These verification artifacts are retained for 14 days.

Windows:

```powershell
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
```

Linux:

```bash
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
```

## Install A Native Artifact

Always verify the downloaded archive against the accompanying `SHA256SUMS`.

Windows PowerShell:

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

Linux:

```bash
grep ' resagent-linux-x64.tar.gz$' SHA256SUMS | sha256sum -c -
mkdir -p "$HOME/.local/bin"
tar -xzf resagent-linux-x64.tar.gz -C "$HOME/.local/bin"
export PATH="$HOME/.local/bin:$PATH"
resagent --version
```

For persistent use, add the installation directory to the user `PATH`.

## Source Installation

Windows PowerShell:

```powershell
git clone --branch resagent --single-branch https://github.com/BoringZheng/ResAgent.git
cd ResAgent
bun install --frozen-lockfile --linker hoisted

$resagent = (Resolve-Path .\packages\opencode\src\index.ts).Path
Set-Location C:\path\to\investigation
$env:RESAGENT_LAUNCH = "1"
bun run $resagent doctor
bun run $resagent research "Summarize the available evidence"
```

Running the saved source entrypoint with `--version` prints `local`. Packaged artifacts carry the
release or CI commit version.

Linux:

```bash
git clone --branch resagent --single-branch https://github.com/BoringZheng/ResAgent.git
cd ResAgent
bun install --frozen-lockfile

resagent_source="$(pwd)/packages/opencode/src/index.ts"
cd /path/to/investigation
export RESAGENT_LAUNCH=1
bun run "$resagent_source" doctor
bun run "$resagent_source" research "Summarize the available evidence"
```

Do not run `node bin/resagent` directly from the source checkout. The package launcher expects an
installed binary layout. Source mode runs `src/index.ts` with Bun.

## Build A Native Artifact

From `packages/opencode`, build the current platform without modifying dependency versions:

```bash
bun run script/build.ts --single --archive --skip-install --skip-embed-web-ui
```

The archive and `SHA256SUMS` are created in `dist/`. Verify the SHA-256 digest before installing
the binary on another machine:

```bash
bun run verify:resagent-release
```

The verifier requires the archive produced for the current native platform. It checks the
checksum manifest, the single `resagent` archive member, executable metadata, extracted size, and
the exact `resagent --version` output.

## Native Release Workflow

`.github/workflows/resagent-release.yml` builds on native Linux x64 and Windows x64 runners for
pushes to the `resagent` branch, relevant pull requests, manual dispatches, and release tags. Each
runner:

1. installs the repository lockfile without dependency downgrades;
2. typechecks `packages/opencode`;
3. builds one native archive;
4. verifies and extracts that archive;
5. runs the complete five-stage research subprocess E2E through the compiled binary;
6. uploads the archive and checksum manifest.

A `resagent-v<version>` tag publishes the native archives with a combined `SHA256SUMS`. Branch,
pull-request, and manual workflow runs upload verification artifacts without creating a GitHub
release.

Maintainers should follow the [release process](resagent-releasing.md) before creating a tag.

## Initial Check

From the directory that will own reports and sessions:

```bash
resagent doctor
```

A release installation is ready when providers, the selected research profile, all five routes,
OpenSSH, and the report directory are reported as `ok`. Remote hosts may be absent when only local
research is required.

In source mode, use:

```powershell
$resagent = "C:\path\to\ResAgent\packages\opencode\src\index.ts"
$env:RESAGENT_LAUNCH = "1"
bun run $resagent doctor
```
