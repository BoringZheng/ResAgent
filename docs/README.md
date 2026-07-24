# ResAgent Documentation

This directory is the entry point for ResAgent user, operator, and maintainer documentation.

## Start Here

| Goal                                                      | Document                                   |
| --------------------------------------------------------- | ------------------------------------------ |
| Complete the first research run                           | [Quickstart](resagent-quickstart.md)       |
| Install a native artifact or run source                   | [Installation](resagent-installation.md)   |
| Configure providers, profiles, hosts, and permissions     | [Configuration](resagent-configuration.md) |
| Use the CLI, TUI, sessions, reports, and remote execution | [Usage](resagent-usage.md)                 |
| Deploy and operate ResAgent responsibly                   | [Security](resagent-security.md)           |
| Move from an existing OpenCode installation               | [Migration](resagent-migration.md)         |
| Build, test, and review repository changes                | [Development](resagent-development.md)     |
| Produce and verify a native release                       | [Release process](resagent-releasing.md)   |

## Documentation Authority

When documents disagree, use this order:

1. executable schemas, CLI behavior, and tests in the current `resagent` branch;
2. `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, and `docs/resagent-*.md`;
3. `specs/resagent.md` and `specs/resagent-threat-model.md` for intended design;
4. `specs/resagent-acceptance.md` for dated verification evidence;
5. inherited package documentation for implementation history only.

The root English `README.md` is the project homepage and canonical overview. `README.zh.md` is a
maintained Simplified Chinese translation. English user and maintainer guides are authoritative.

## Source Of Truth By Topic

| Topic                                 | Authoritative document                               |
| ------------------------------------- | ---------------------------------------------------- |
| Product scope and supported platforms | Root [README](../README.md)                          |
| First-run procedure                   | [Quickstart](resagent-quickstart.md)                 |
| Artifact and source installation      | [Installation](resagent-installation.md)             |
| Configuration fields and examples     | [Configuration](resagent-configuration.md)           |
| Command behavior and troubleshooting  | [Usage](resagent-usage.md)                           |
| Vulnerability reporting               | Root [security policy](../SECURITY.md)               |
| Operational security guidance         | [Security](resagent-security.md)                     |
| Architecture contract                 | [Product specification](../specs/resagent.md)        |
| Detailed threats and mitigations      | [Threat model](../specs/resagent-threat-model.md)    |
| Test and release evidence             | [Acceptance record](../specs/resagent-acceptance.md) |
| Contribution rules                    | Root [contribution guide](../CONTRIBUTING.md)        |
| Contributor conduct                   | Root [Code of Conduct](../CODE_OF_CONDUCT.md)        |
| Maintainer release procedure          | [Release process](resagent-releasing.md)             |

Long procedures should live in one authoritative document. Other pages should summarize the
decision and link to that procedure instead of copying it.

## Naming And Compatibility

The product and installed executable are named **ResAgent** and `resagent`. The codebase keeps
OpenCode-compatible configuration paths, environment variables, package names, generated SDK
names, and internal implementation text. These names are compatibility details, not separate
ResAgent installation channels. Standalone CLI help and commands use `resagent`.

The expected configuration filenames remain `opencode.json[c]`, and the inherited schema URL
remains `https://opencode.ai/config.json`. Do not rename them in documentation unless the
implementation changes first.

## Inherited Documentation

This repository contains the full OpenCode-derived monorepo. READMEs under `packages/`, `github/`,
and other implementation directories may describe upstream packages, websites, desktop
applications, or publishing workflows that ResAgent does not distribute.

Those files are retained for package-level development and upstream synchronization. They are not
ResAgent user documentation and do not override the root README or this directory. A contributor
changing an inherited package should update its local README only when that package's behavior
changes.

## Maintenance Checklist

For every user-visible change:

1. update the authoritative guide for the changed behavior;
2. update the root README only when the project overview, support matrix, or primary workflow
   changes;
3. update the product specification for an architecture or product-contract change;
4. add current test evidence to the acceptance record when the acceptance boundary changes;
5. keep Windows and Linux commands executable and do not add macOS instructions;
6. run Markdown formatting, relative-link validation, and stale-brand scans before merging.
