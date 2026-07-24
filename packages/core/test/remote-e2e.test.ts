import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Layer, Schema } from "effect"
import { Config } from "@opencode-ai/core/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Global } from "@opencode-ai/core/global"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Remote } from "@opencode-ai/core/remote"
import { SessionV2 } from "@opencode-ai/core/session"
import { RemoteRunTool } from "@opencode-ai/core/tool/remote-run"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { available, sshdFixture, type SshdFixture } from "./fixture/sshd"
import { executeTool, settleTool, toolIdentity } from "./lib/tool"

const decode = Schema.decodeUnknownSync(Config.Info)
const sshTest = test.skipIf(!available)

describe("Remote OpenSSH E2E", () => {
  sshTest(
    "runs against two independent host keys and preserves requested order",
    async () => {
      await using fixture = await sshdFixture()
      const output = await run(
        fixture,
        Effect.gen(function* () {
          const remote = yield* Remote.Service
          const hosts = yield* Effect.forEach(["lab-b", "lab-a"], remote.get)
          return yield* Effect.forEach(hosts, (host) => remote.run({ host, command: echoCommand(host.alias) }), {
            concurrency: 2,
          })
        }),
      )

      expect(output.map((result) => result.host)).toEqual(["lab-b", "lab-a"])
      expect(output.map((result) => result.status)).toEqual(["ok", "ok"])
      expect(output.map((result) => result.exit)).toEqual([0, 0])
      expect(output.every((result) => result.duration_ms >= 0)).toBe(true)
      expect(output.map((result) => result.stdout.trim())).toEqual(["lab-b", "lab-a"])
      expect(fixture.servers.map((server) => server.connections())).toEqual([1, 1])
      expect(fixture.servers[0]?.hostKey).not.toBe(fixture.servers[1]?.hostKey)
    },
    20_000,
  )

  sshTest(
    "returns independent unreachable, timeout, host-key, and truncated results",
    async () => {
      await using fixture = await sshdFixture()
      const wrongKnownHosts = path.join(fixture.path, "wrong-known-hosts")
      const server = fixture.servers[0]!
      const wrongKey = fixture.servers[1]!.knownHostsLine.split(/\s+/)
      await fs.writeFile(wrongKnownHosts, `[127.0.0.1]:${server.port} ${wrongKey[1]} ${wrongKey[2]}\n`)
      const unavailablePort = await closedPort()

      const output = await run(
        fixture,
        Effect.gen(function* () {
          const remote = yield* Remote.Service
          const base = yield* remote.get("lab-a")
          return yield* Effect.all(
            [
              remote.run({
                host: { ...base, port: unavailablePort, connectTimeout: 1 },
                command: "echo unreachable",
              }),
              remote.run({ host: base, command: timeoutCommand(), timeout: 100 }),
              remote.run({
                host: { ...base, knownHostsFile: wrongKnownHosts },
                command: "echo mismatch",
              }),
              remote.run({ host: base, command: largeOutputCommand() }),
            ],
            { concurrency: 4 },
          )
        }),
      )

      expect(output[0]).toMatchObject({ host: "lab-a", status: "failed", exit: 255 })
      expect(output[1]).toMatchObject({ host: "lab-a", status: "timeout" })
      expect(output[2]).toMatchObject({ host: "lab-a", status: "failed", exit: 255 })
      expect(output[2]?.stderr.toLowerCase()).toContain("host key verification failed")
      expect(output[3]).toMatchObject({ host: "lab-a", status: "ok", truncated: true })
      expect(Buffer.byteLength(output[3]!.stdout)).toBe(Remote.MAX_CAPTURE_BYTES)
    },
    25_000,
  )

  sshTest(
    "does not interpret remote metacharacters locally",
    async () => {
      await using fixture = await sshdFixture(1)
      const marker = `resagent-local-${crypto.randomUUID()}`
      const localMarker = path.join(process.cwd(), marker)
      await run(
        fixture,
        Effect.gen(function* () {
          const remote = yield* Remote.Service
          const host = yield* remote.get("lab-a")
          const result = yield* remote.run({ host, command: metacharacterCommand(marker) })
          expect(result).toMatchObject({ status: "ok" })
          expect(result.stdout).toContain("REMOTE_OK")
          yield* remote.run({ host, command: removeCommand(marker) })
        }),
      )
      expect(await fs.exists(localMarker)).toBe(false)
    },
    15_000,
  )

  sshTest(
    "interrupts the local SSH process and terminates its remote command",
    async () => {
      await using fixture = await sshdFixture(1)
      const started = path.join(fixture.path, "started")
      const completed = path.join(fixture.path, "completed")
      await run(
        fixture,
        Effect.gen(function* () {
          const remote = yield* Remote.Service
          const host = yield* remote.get("lab-a")
          const fiber = yield* remote
            .run({ host, command: cancellableCommand(started, completed) })
            .pipe(Effect.forkChild)
          yield* Effect.promise(() => waitForFile(started))
          yield* Fiber.interrupt(fiber)
          yield* Effect.sleep("750 millis")
        }),
      )

      expect(await fs.exists(started)).toBe(true)
      expect(await fs.exists(completed)).toBe(false)
      expect(fixture.servers[0]?.log()).toMatch(/Close session|Connection reset/)
    },
    20_000,
  )

  sshTest(
    "opens zero connections when permission is denied or corrected, then runs a corrected command",
    async () => {
      await using fixture = await sshdFixture(1)
      const sessionID = SessionV2.ID.make("ses_remote_e2e_permission")
      const denied = await runTool(
        fixture,
        () => Effect.fail(new PermissionV2.BlockedError({ rules: [] })),
        ToolRegistry.Service.use((registry) =>
          executeTool(registry, call(sessionID, { hosts: ["lab-a"], command: "echo denied" })),
        ),
      )
      const corrected = await runTool(
        fixture,
        () => Effect.fail(new PermissionV2.CorrectedError({ feedback: "Use a read-only command" })),
        ToolRegistry.Service.use((registry) =>
          executeTool(registry, call(sessionID, { hosts: ["lab-a"], command: "echo corrected" })),
        ),
      )

      expect(denied).toEqual({ type: "error", value: "Remote command was not approved" })
      expect(corrected).toEqual({ type: "error", value: "Use a read-only command" })
      expect(fixture.servers[0]?.connections()).toBe(0)

      const resumed = await runTool(
        fixture,
        () => Effect.void,
        ToolRegistry.Service.use((registry) =>
          settleTool(registry, call(sessionID, { hosts: ["lab-a"], command: echoCommand("corrected") })),
        ),
      )

      expect(resumed.result.type).toBe("content")
      if (resumed.result.type !== "content") throw new Error("Expected corrected remote command content")
      expect(resumed.result.value[0]).toMatchObject({ type: "text", text: "[lab-a] ok (exit 0)" })
      expect(resumed.result.value[1]?.type).toBe("text")
      expect(resumed.result.value[1]?.text.trim()).toBe("corrected")
      expect(resumed.output).toBeDefined()
      if (!resumed.output) throw new Error("Expected corrected remote command output")
      expect(resumed.output.structured).toMatchObject({
        results: [{ host: "lab-a", status: "ok", exit: 0 }],
      })
      expect(fixture.servers[0]?.connections()).toBe(1)
    },
    15_000,
  )

  sshTest(
    "interrupts the active host without starting the remaining target",
    async () => {
      await using fixture = await sshdFixture()
      const started = path.join(fixture.path, "tool-started")
      const completed = path.join(fixture.path, "tool-completed")
      await runTool(
        fixture,
        () => Effect.void,
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const fiber = yield* settleTool(
            registry,
            call(SessionV2.ID.make("ses_remote_e2e_cancel"), {
              hosts: ["lab-a", "lab-b"],
              command: cancellableCommand(started, completed),
              concurrency: 1,
            }),
          ).pipe(Effect.forkChild)
          yield* Effect.promise(() => waitForFile(started))
          yield* Fiber.interrupt(fiber)
          yield* Effect.sleep("500 millis")
        }),
      )

      expect(await fs.exists(completed)).toBe(false)
      expect(fixture.servers.map((server) => server.connections())).toEqual([1, 0])
    },
    20_000,
  )
})

function run<A, E>(fixture: SshdFixture, effect: Effect.Effect<A, E, Remote.Service>) {
  const layer = AppNodeBuilder.build(Remote.node, [
    [Config.node, configLayer(fixture)],
    [Global.node, Global.layerWith({ home: fixture.path })],
  ])
  return Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.scoped))
}

function runTool<A, E>(
  fixture: SshdFixture,
  assert: PermissionV2.Interface["assert"],
  effect: Effect.Effect<A, E, ToolRegistry.Service>,
) {
  const permission = Layer.succeed(
    PermissionV2.Service,
    PermissionV2.Service.of({
      assert,
      ask: () => Effect.die("unused"),
      reply: () => Effect.die("unused"),
      get: () => Effect.die("unused"),
      forSession: () => Effect.die("unused"),
      list: () => Effect.die("unused"),
    }),
  )
  const layer = AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, RemoteRunTool.node]), [
    [Config.node, configLayer(fixture)],
    [Global.node, Global.layerWith({ home: fixture.path })],
    [PermissionV2.node, permission],
    [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
  ])
  return Effect.runPromise(effect.pipe(Effect.provide(layer), Effect.scoped))
}

function configLayer(fixture: SshdFixture) {
  return Layer.succeed(
    Config.Service,
    Config.Service.of({
      entries: () =>
        Effect.succeed([
          new Config.Document({
            type: "document",
            info: decode({
              remotes: Object.fromEntries(
                fixture.servers.map((server, index) => [
                  `lab-${String.fromCharCode(97 + index)}`,
                  {
                    host: "127.0.0.1",
                    user: fixture.user,
                    port: server.port,
                    identity_file: fixture.clientKey,
                    known_hosts_file: fixture.knownHostsFile,
                    connect_timeout: 2,
                    command_timeout: 5_000,
                    max_concurrency: 4,
                  },
                ]),
              ),
            }),
          }),
        ]),
    }),
  )
}

function call(sessionID: SessionV2.ID, input: typeof RemoteRunTool.Input.Type) {
  return {
    sessionID,
    ...toolIdentity,
    call: {
      type: "tool-call" as const,
      id: `call-${sessionID}`,
      name: RemoteRunTool.name,
      input,
    },
  }
}

async function closedPort() {
  const net = await import("node:net")
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close()
        reject(new Error("Unable to allocate a closed test port"))
        return
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
}

async function waitForFile(file: string, timeout = 5_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await fs.exists(file)) return
    await Bun.sleep(25)
  }
  throw new Error(`Timed out waiting for ${file}`)
}

function echoCommand(value: string) {
  return process.platform === "win32" ? `echo ${value}` : `printf '%s\\n' '${value}'`
}

function timeoutCommand() {
  if (process.platform === "win32") {
    return 'powershell -NoProfile -NonInteractive -Command "Start-Sleep -Seconds 5"'
  }
  return "sleep 5"
}

function largeOutputCommand() {
  if (process.platform === "win32") {
    return 'powershell -NoProfile -NonInteractive -Command "[Console]::Out.Write(' + "'x' * 600000" + ')"'
  }
  return "yes x | head -c 600000"
}

function metacharacterCommand(marker: string) {
  if (process.platform === "win32") return `echo REMOTE_OK; Set-Content -LiteralPath ${marker} -Value touched`
  return `printf REMOTE_OK; printf touched > '${marker}'`
}

function removeCommand(marker: string) {
  if (process.platform === "win32") return `del /q ${marker}`
  return `rm -f '${marker}'`
}

function cancellableCommand(started: string, completed: string) {
  if (process.platform === "win32") {
    return `powershell -NoProfile -NonInteractive -Command "Set-Content -LiteralPath '${started}' -Value started; Start-Sleep -Seconds 10; Set-Content -LiteralPath '${completed}' -Value completed"`
  }
  return `printf started > '${started}'; sleep 10; printf completed > '${completed}'`
}
