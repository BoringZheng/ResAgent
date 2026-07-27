# ResAgent Release Process

ResAgent publishes native terminal artifacts for Windows x64 and Linux x64. macOS artifacts are
not supported.

## Release Outputs

| Platform    | Archive                     |
| ----------- | --------------------------- |
| Windows x64 | `resagent-windows-x64.zip`  |
| Linux x64   | `resagent-linux-x64.tar.gz` |

Every release also publishes a combined `SHA256SUMS`.

## Release Workflow

`.github/workflows/resagent-release.yml` runs for:

- relevant pull requests;
- pushes to the `resagent` branch;
- manual workflow dispatches;
- tags matching `resagent-v*`.

The native matrix uses one Windows runner and one Linux runner. Each job:

1. installs the frozen lockfile;
2. typechecks `packages/opencode`;
3. builds one archive for the native host;
4. verifies checksum, archive membership, executable metadata, extraction, size, and version;
5. runs the five-stage research E2E through the compiled binary;
6. uploads the archive and checksum manifest.

Only a tag run publishes a GitHub release. Pull request, branch, and manual runs provide
short-lived verification artifacts.

## Prepare A Release

1. Confirm the `resagent` branch is clean and synchronized with the intended upstream baseline.
2. Review [the acceptance record](../specs/resagent-acceptance.md) and resolve or explicitly
   record every release-blocking risk.
3. Run affected package typechecks and focused tests from their package directories.
4. Build and verify the current platform locally from `packages/opencode`.
5. Confirm the latest `ResAgent native release` branch workflow passed on both Windows and Linux.
6. Review user documentation, supported-platform claims, migration notes, and security guidance.
7. Choose a version and create an annotated tag named `resagent-v<version>`.

Example:

```bash
git switch resagent
git pull --ff-only fork resagent
git tag -a resagent-v0.1.0 -m "ResAgent 0.1.0"
git push fork resagent-v0.1.0
```

Do not reuse or move a published release tag.

## Verify The Published Release

After the tag workflow completes:

1. confirm both native jobs and the publish job succeeded;
2. download both archives and the combined `SHA256SUMS`;
3. verify each archive independently;
4. extract each archive on its supported operating system;
5. run `resagent --version` and confirm it matches the tag version;
6. run `resagent doctor` with a valid local profile;
7. record the workflow, artifact digests, smoke tests, and residual risks in the acceptance
   record.

Windows checksum verification:

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
```

Linux:

```bash
grep ' resagent-linux-x64.tar.gz$' SHA256SUMS | sha256sum -c -
```

## Rollback And Revocation

If a release is defective but not security-sensitive, mark it as a prerelease or remove it from
the recommended path, document the defect, and publish a new version. Do not replace existing
assets under the same tag.

For a security issue, follow [SECURITY.md](../SECURITY.md), preserve evidence privately, revoke
affected credentials when needed, publish a fixed tag, and use a GitHub Security Advisory to
explain impact and remediation.

## Repository Actions

`ResAgent native release` is the only supported GitHub Actions acceptance and release workflow
for this fork. The inherited OpenCode workflow files remain in the source tree to reduce upstream
synchronization conflicts, but their workflows are disabled in `BoringZheng/ResAgent`. They
depend on upstream-only runners, credentials, repositories, release channels, and issue or pull
request maintenance policy.

Do not treat inherited workflow failures, skipped jobs, or historical runs as ResAgent acceptance
results. A ResAgent release is valid only when `resagent-release.yml` succeeds for both native
jobs on a `resagent-v*` tag and publishes the assets verified above.
