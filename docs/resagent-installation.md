# ResAgent Installation

## Prerequisites

- Bun `1.3.14`
- Git
- OpenSSH client (`ssh`) for remote execution
- A configured model provider supported by OpenCode

## Source Installation

```bash
git clone <resagent-repository>
cd ResAgent
bun install
cd packages/opencode
```

Run the standalone wrapper:

```bash
./bin/resagent doctor
./bin/resagent research "Summarize the available evidence"
```

On Windows:

```powershell
node .\bin\resagent doctor
node .\bin\resagent research "Summarize the available evidence"
```

## Native Artifact

Native release artifacts are supported on Linux x64 and Windows x64. macOS release builds are
intentionally out of scope.

Build the current platform without modifying dependency versions:

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

## Initial Check

From the directory that will own reports and sessions:

```bash
resagent doctor
```

A release installation is ready when providers, the selected research profile, all five routes,
OpenSSH, and the report directory are reported as `ok`. Remote hosts may be absent when only local
research is required.
