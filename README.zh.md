# ResAgent

**面向终端的研究 Agent：支持持久化多 Provider 调研，以及对命名 SSH 主机进行权限受控的远程操作。**

[![原生构建](https://github.com/BoringZheng/ResAgent/actions/workflows/resagent-release.yml/badge.svg?branch=resagent)](https://github.com/BoringZheng/ResAgent/actions/workflows/resagent-release.yml)
[![平台](https://img.shields.io/badge/platform-Windows%20x64%20%7C%20Linux%20x64-4c8bf5)](#平台支持)
[![许可证](https://img.shields.io/badge/license-MIT-2ea44f)](LICENSE)

[English](README.md) | [简体中文](README.zh.md)

ResAgent 会把一个研究问题转换为五个持久化阶段：规划、收集、分析、验证和报告。每个阶段使用显式、有顺序的模型路由。同一个 Session 可以收集本地证据、调用已配置工具，并在不授予模型任意 SSH 访问权的前提下，对远程主机白名单执行经过批准的命令。

ResAgent 基于 [OpenCode](https://github.com/anomalyco/opencode) 构建，保留了 OpenCode 的 Provider 目录、Session 引擎、权限模型、TUI 和内部包边界，同时发布独立的 `resagent` 发行版。本项目不由 OpenCode 团队维护，也不代表与其存在隶属或背书关系。

## 项目状态

ResAgent 当前处于**候选发布版本**阶段。完整研究工作流、Windows/Linux 原生构建、编译后二进制 E2E、多 Provider 路由、报告导出和有边界的 SSH 执行均已实现，并由原生发布工作流验证。

`ResAgent native release` 是本 Fork 唯一受支持的 GitHub Actions 验收与发布工作流。继承自 OpenCode 的自动化依赖仅供上游使用的 Runner、凭据、仓库和维护策略，因此已在本 GitHub 仓库中停用。

当前兼容性契约尚未稳定。需要可重复部署时，请固定 Release Tag 或 Commit。ResAgent 产品分支和默认分支都是 `resagent`；源码安装仍显式指定该分支，避免 Checkout 意外跟随上游分支。

## 为什么使用 ResAgent

- **持久化研究工作流。** Provider 尝试和阶段进度记录在 Session 中，不依赖第二套内存 Agent 循环。
- **多 Provider 路由。** 每个角色都有一个有顺序的 `provider/model` 路由，且只会对已分类、可安全重放的失败执行有限回退。
- **远程证据收集。** `remote_run` 只能选择已配置别名；每个 `<主机> <命令>` 精确资源都要先授权，并独立返回每台主机的结果。
- **可审查报告。** Markdown 报告包含结论、局限性、Provider 尝试记录和相关工具来源。
- **CLI 与 TUI。** 既可以在自动化环境中非交互运行，也可以通过终端 UI 完成 Provider 配置、研究进度查看、远程目标选择和结果检查。
- **发布验证。** 原生归档包含校验和，并在 Windows 与 Linux 原生 Runner 上通过编译后二进制完整测试。

## 工作方式

```text
研究问题
   |
   v
规划 -> 收集 -> 分析 -> 验证 -> 报告
  |      |       |       |      |
  +------+-------+-------+------+
                 |
         有顺序的 Provider 路由
                 |
           已配置模型 Provider

收集阶段可以调用 remote_run
                 |
                 +-> 精确权限：<别名> <命令>
                 +-> OpenSSH -> 已配置主机白名单
                 +-> 每台主机独立、有边界的结果
```

研究工作流归 Session 所有，并按 Location 隔离。启动 ResAgent 时所在的目录决定项目配置、Session、远程主机清单和允许写入的报告路径。

## 平台支持

| 平台        | 原生归档                    | 源码开发 | 状态       |
| ----------- | --------------------------- | -------- | ---------- |
| Windows x64 | `resagent-windows-x64.zip`  | 支持     | 支持       |
| Linux x64   | `resagent-linux-x64.tar.gz` | 支持     | 支持       |
| macOS       | 无                          | 不支持   | 不在范围内 |

本项目不承诺 macOS 兼容性或发布支持。上游桌面应用和 OpenCode 的包管理器安装渠道都不是 ResAgent 的发行渠道。

## 快速开始

正常使用建议按照[安装指南](docs/resagent-installation.md)安装经过验证的原生归档。要在 Windows 上运行当前源码分支：

```powershell
git clone --branch resagent --single-branch https://github.com/BoringZheng/ResAgent.git
cd ResAgent
bun install --frozen-lockfile --linker hoisted

$resagent = (Resolve-Path .\packages\opencode\src\index.ts).Path
New-Item -ItemType Directory -Path ..\resagent-workspace -Force | Out-Null
Set-Location ..\resagent-workspace
$env:RESAGENT_LAUNCH = "1"
bun run $resagent auth login
bun run $resagent models
```

在将要执行研究任务的目录中创建 `opencode.jsonc`。把所有示例模型替换为 `models` 返回的精确标识：

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
        "verifier": ["provider/model-verifier"],
        "writer": ["provider/model-writer"],
      },
    },
  },
}
```

检查环境并运行第一次研究：

```powershell
bun run $resagent doctor
bun run $resagent research `
  --output .resagent/reports/first-report.md `
  "比较现有证据，并找出尚未解决的矛盾。"
```

安装原生归档后，命令更短：

```bash
resagent doctor
resagent research "现有证据支持什么结论？"
resagent
```

最后一个命令会打开 TUI。[快速入门](docs/resagent-quickstart.md)完整覆盖 Provider 登录、Profile 创建、报告导出、Session 续接和可选远程主机配置。

## 远程执行

远程执行默认不开启。Prompt 不能引入新的主机名，只能选择 `remotes` 中定义的别名。

```jsonc
{
  "remotes": {
    "research-a": {
      "host": "research-a",
      "host_key": "strict",
      "command_timeout": 120000,
      "max_concurrency": 1,
      "tags": ["linux", "research"],
    },
  },
}
```

启动任何 SSH 进程前，ResAgent 会解析全部别名，并为每个精确资源请求权限：

```text
research-a uname -a
```

ResAgent 直接调用 OpenSSH，启用批处理模式，禁用转发和交互式密码认证，强制主机密钥校验，并限制输出与执行时间，同时保留每台主机的独立状态。但权限系统仍然只是策略和用户感知边界，不是操作系统沙箱。授予远程权限前，请阅读[安全指南](docs/resagent-security.md)。

## 文档

| 文档                                       | 读者           | 用途                                     |
| ------------------------------------------ | -------------- | ---------------------------------------- |
| [文档索引](docs/README.md)                 | 所有人         | 权威层级、导航和上游内部文档边界         |
| [快速入门](docs/resagent-quickstart.md)    | 新用户         | 第一个 Provider、Profile、报告和可选主机 |
| [安装指南](docs/resagent-installation.md)  | 用户           | 原生归档、校验和、源码模式和构建         |
| [配置参考](docs/resagent-configuration.md) | 用户与运维人员 | Profile、Provider 路由、主机和权限       |
| [使用指南](docs/resagent-usage.md)         | 用户           | CLI、TUI、Session、报告和故障排查        |
| [安全指南](docs/resagent-security.md)      | 运维人员       | 信任边界和部署建议                       |
| [迁移指南](docs/resagent-migration.md)     | OpenCode 用户  | 兼容性和回滚                             |
| [开发指南](docs/resagent-development.md)   | 贡献者         | 仓库配置、架构、测试和审查               |
| [发布流程](docs/resagent-releasing.md)     | 维护者         | 原生工作流、Tag、校验和和验证            |
| [产品规范](specs/resagent.md)              | 维护者         | 产品和架构契约                           |
| [验收记录](specs/resagent-acceptance.md)   | 维护者         | 测试证据和残余风险                       |

英文用户与维护者文档是权威来源。本中文 README 提供同步维护的项目概览。

## 架构

ResAgent 遵循仓库既有依赖方向：

```text
Schema
  +-> Core
  +-> Protocol
        +-> Server
        +-> Client

sdk-next 组合 Client、Core 和 Server。
packages/opencode 承载兼容 CLI 和原生发行版。
packages/tui 只使用公开 SDK 边界。
```

研究配置、Provider 路由、工作流状态、SSH 清单和 `remote_run` 位于 Core。公开 HTTP 契约位于 Protocol 和 Server。发行命令与打包位于 `packages/opencode`，交互界面位于 `packages/tui`。

## 开发

ResAgent 要求使用根目录 `package.json` 固定的 Bun 版本。安装冻结锁文件后，从受影响的包目录运行检查，不要从仓库根目录运行测试：

```powershell
bun install --frozen-lockfile --linker hoisted
cd packages\opencode
bun typecheck
bun test test\cli\research-process.test.ts --timeout 90000
bun run script\build.ts --single --archive --skip-install --skip-embed-web-ui
bun run verify:resagent-release
```

修改公开 API、生成客户端、远程行为或发布自动化前，请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和[开发指南](docs/resagent-development.md)。

## 已知限制

- 不支持 macOS。
- 原生发行版当前只面向 Windows x64 和 Linux x64。
- Research Profile 和远程清单继续使用继承的 `opencode.json[c]` 路径；Schema URL 和内部 `@opencode-ai/*` 包名为了兼容性保持不变。
- 内部实现文本和兼容路径仍可能使用 `opencode`；独立发行版的 CLI 帮助与命令统一使用 `resagent`。
- 远程执行只使用 OpenSSH。密码认证、WinRM、Kubernetes 和任意长期远程后台任务不在当前范围内。
- 权限 UI 不会沙箱化本地进程，也不会让已批准的命令自动变得安全。
- 分支 CI Artifact 保存 14 天；Tag Release 才是长期发行渠道。

## 贡献与安全

贡献应基于 `resagent` 分支，并使用 `fix(core): preserve remote result order` 这类 Conventional Commit 标题。分支、测试、生成代码和远程测试规则见 [CONTRIBUTING.md](CONTRIBUTING.md)，参与行为规范见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

不要在公开 Issue 中披露漏洞。请按照 [SECURITY.md](SECURITY.md)，通过本仓库的 GitHub Security Advisory 表单私密报告。

## 许可证与上游归属

ResAgent 使用 [MIT License](LICENSE) 发布。项目派生自 OpenCode，并保留上游版权、许可证声明、包名和实现历史。ResAgent 自身的文档、品牌、工作流行为和发布归档属于此 Fork，不表示 OpenCode 维护者对本项目的认可或背书。
