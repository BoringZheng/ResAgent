# ResAgent Distribution Host

This package keeps the inherited internal name `opencode` for workspace and upstream
compatibility. It hosts the ResAgent CLI entrypoint, runtime assembly, compatibility commands,
native build, release verifier, and compiled-binary E2E.

It is not a separately published ResAgent package. Start with the repository
[README](../../README.md) and [documentation index](../../docs/README.md).

## Run From Source

Windows PowerShell:

```powershell
$env:RESAGENT_LAUNCH = "1"
bun run src\index.ts doctor
bun run src\index.ts research "Summarize the evidence."
bun run src\index.ts
```

Linux:

```bash
RESAGENT_LAUNCH=1 bun run src/index.ts doctor
RESAGENT_LAUNCH=1 bun run src/index.ts research "Summarize the evidence."
RESAGENT_LAUNCH=1 bun run src/index.ts
```

Do not run `node bin/resagent` from the source tree. The launcher expects an installed binary
layout.

## Validate

Run from this package:

```bash
bun typecheck
bun test test/cli/research-process.test.ts --timeout 90000
```

Build and verify the current native platform:

```bash
bun run script/build.ts --single --archive --skip-install --skip-embed-web-ui
bun run verify:resagent-release
```

Release artifacts are supported for Windows x64 and Linux x64. See the
[release process](../../docs/resagent-releasing.md).
