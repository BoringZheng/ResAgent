import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Config } from "@opencode-ai/core/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { AppProcess } from "@opencode-ai/core/process"
import { Remote } from "@opencode-ai/core/remote"
import { testEffect } from "./lib/effect"

const decode = Schema.decodeUnknownSync(Config.Info)

function document(info: unknown) {
  return new Config.Document({ type: "document", info: decode(info) })
}

describe("Remote helpers", () => {
  test("loads layered aliases with complete replacement and expands home paths", () => {
    const hosts = Remote.load(
      [
        document({
          remotes: {
            lab: {
              host: "old.example.net",
              user: "old",
              identity_file: "~/.ssh/old",
              max_concurrency: 4,
            },
          },
        }),
        document({
          remotes: {
            lab: {
              host: "new.example.net",
              identity_file: "~/.ssh/new",
            },
            backup: {
              host: "backup.example.net",
            },
          },
        }),
      ],
      "/home/tester",
    )

    expect([...hosts.keys()]).toEqual(["lab", "backup"])
    expect(hosts.get("lab" as never)).toMatchObject({
      host: "new.example.net",
      user: undefined,
      identityFile: path.resolve("/home/tester", ".ssh/new"),
      maxConcurrency: 1,
    })
  })

  test("builds a non-interactive OpenSSH argument list with no user options", () => {
    const host: Remote.Host = {
      alias: "lab-a" as never,
      host: "lab-a.example.net",
      user: "research",
      port: 2222,
      identityFile: "/home/tester/.ssh/id_ed25519",
      knownHostsFile: "/home/tester/.ssh/known_hosts",
      hostKey: "strict",
      proxyJump: "bastion@example.net",
      connectTimeout: 12,
      commandTimeout: 30000,
      maxConcurrency: 2,
      tags: ["lab"],
    }

    expect(Remote.argumentsFor(host, "printf '$HOME'; touch /tmp/remote-only")).toEqual([
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ClearAllForwardings=yes",
      "-o",
      "ForwardAgent=no",
      "-o",
      "ForwardX11=no",
      "-o",
      "LogLevel=ERROR",
      "-o",
      "PermitLocalCommand=no",
      "-o",
      "PasswordAuthentication=no",
      "-o",
      "KbdInteractiveAuthentication=no",
      "-o",
      "ConnectTimeout=12",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "UserKnownHostsFile=/home/tester/.ssh/known_hosts",
      "-o",
      "IdentitiesOnly=yes",
      "-i",
      "/home/tester/.ssh/id_ed25519",
      "-J",
      "bastion@example.net",
      "-p",
      "2222",
      "--",
      "research@lab-a.example.net",
      "printf '$HOME'; touch /tmp/remote-only",
    ])
  })
})

const runs: Array<{
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly options?: AppProcess.RunOptions
}> = []
let result: AppProcess.RunResult = {
  command: "ssh",
  exitCode: 0,
  stdout: Buffer.from("Linux\n"),
  stderr: Buffer.alloc(0),
  stdoutTruncated: false,
  stderrTruncated: false,
}
let failure: AppProcess.AppProcessError | undefined

const processLayer = Layer.succeed(
  AppProcess.Service,
  AppProcess.Service.of({
    run: (command: ChildProcess.Command, options?: AppProcess.RunOptions) =>
      Effect.suspend(() => {
        if (command._tag !== "StandardCommand") return Effect.die("expected standard command")
        runs.push({ command: command.command, args: command.args, options })
        return failure ? Effect.fail(failure) : Effect.succeed(result)
      }),
  } as unknown as AppProcess.Interface),
)
const configLayer = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed([
        document({
          remotes: {
            lab: {
              host: "lab.example.net",
              user: "research",
              command_timeout: 5000,
            },
          },
        }),
      ]),
  }),
)
const remoteLayer = AppNodeBuilder.build(Remote.node, [
  [Config.node, configLayer],
  [Global.node, Global.layerWith({ home: "/home/tester" })],
  [AppProcess.node, processLayer],
])
const it = testEffect(remoteLayer)

function reset() {
  runs.length = 0
  failure = undefined
  result = {
    command: "ssh",
    exitCode: 0,
    stdout: Buffer.from("Linux\n"),
    stderr: Buffer.alloc(0),
    stdoutTruncated: false,
    stderrTruncated: false,
  }
}

describe("Remote service", () => {
  it.effect("runs SSH directly and returns typed output", () =>
    Effect.gen(function* () {
      reset()
      const remote = yield* Remote.Service
      const host = yield* remote.get("lab")
      const output = yield* remote.run({ host, command: "uname -a" })

      expect(output).toMatchObject({
        host: "lab",
        status: "ok",
        exit: 0,
        stdout: "Linux\n",
        stderr: "",
        truncated: false,
      })
      expect(runs).toHaveLength(1)
      expect(runs[0]?.command).toBe("ssh")
      expect(runs[0]?.args.at(-1)).toBe("uname -a")
      expect(runs[0]?.options).toMatchObject({
        maxOutputBytes: Remote.MAX_CAPTURE_BYTES,
        maxErrorBytes: Remote.MAX_CAPTURE_BYTES,
      })
    }),
  )

  it.effect("maps timeout and process failures without losing the host result", () =>
    Effect.gen(function* () {
      reset()
      const remote = yield* Remote.Service
      const host = yield* remote.get("lab")
      failure = new AppProcess.AppProcessError({
        command: "ssh",
        cause: new Error("Timed out"),
      })
      expect(yield* remote.run({ host, command: "sleep 10", timeout: 50 })).toMatchObject({
        host: "lab",
        status: "timeout",
        stderr: "Command exceeded timeout of 50 ms.",
      })

      failure = undefined
      result = {
        command: "ssh",
        exitCode: 7,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from("failed\n"),
        stdoutTruncated: false,
        stderrTruncated: false,
      }
      expect(yield* remote.run({ host, command: "false" })).toMatchObject({
        host: "lab",
        status: "failed",
        exit: 7,
        stderr: "failed\n",
      })
    }),
  )

  it.effect("redacts configured key paths from process output and failures", () =>
    Effect.gen(function* () {
      reset()
      const remote = yield* Remote.Service
      const base = yield* remote.get("lab")
      const host: Remote.Host = {
        ...base,
        identityFile: "/home/tester/.ssh/private-key",
        knownHostsFile: "/home/tester/.ssh/known_hosts",
      }
      result = {
        command: "ssh",
        exitCode: 255,
        stdout: Buffer.from("/home/tester/.ssh/private-key\n"),
        stderr: Buffer.from("known hosts: /home/tester/.ssh/known_hosts\n"),
        stdoutTruncated: false,
        stderrTruncated: false,
      }
      expect(yield* remote.run({ host, command: "true" })).toMatchObject({
        stdout: "<redacted-path>\n",
        stderr: "known hosts: <redacted-path>\n",
      })

      failure = new AppProcess.AppProcessError({
        command: "ssh -i /home/tester/.ssh/private-key",
        stderr: "Identity file /home/tester/.ssh/private-key not accessible",
      })
      expect(yield* remote.run({ host, command: "true" })).toMatchObject({
        stderr: "Identity file <redacted-path> not accessible",
      })
    }),
  )

  it.effect("rejects unknown aliases before process execution", () =>
    Effect.gen(function* () {
      reset()
      const remote = yield* Remote.Service
      expect(yield* Effect.flip(remote.get("missing"))).toBeInstanceOf(Remote.UnknownHostError)
      expect(runs).toEqual([])
    }),
  )
})
