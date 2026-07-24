import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Remote } from "@opencode-ai/core/remote"
import { SessionV2 } from "@opencode-ai/core/session"
import { RemoteRunTool } from "@opencode-ai/core/tool/remote-run"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"
import { executeTool, settleTool, toolDefinitions, toolIdentity } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_remote_run_test")
const assertions: PermissionV2.AssertInput[] = []
const runs: string[] = []
let denied = false

const hosts: Remote.Host[] = [
  {
    alias: "lab-a" as never,
    host: "lab-a.example.net",
    port: 22,
    hostKey: "strict",
    connectTimeout: 10,
    commandTimeout: 120000,
    maxConcurrency: 1,
    tags: [],
  },
  {
    alias: "lab-b" as never,
    host: "lab-b.example.net",
    port: 22,
    hostKey: "strict",
    connectTimeout: 10,
    commandTimeout: 120000,
    maxConcurrency: 1,
    tags: [],
  },
]

const remote = Layer.succeed(
  Remote.Service,
  Remote.Service.of({
    list: () => Effect.succeed(hosts),
    get: (alias) => {
      const host = hosts.find((item) => item.alias === alias)
      return host ? Effect.succeed(host) : Effect.fail(new Remote.UnknownHostError({ alias }))
    },
    run: ({ host, command }) =>
      Effect.sync(() => {
        runs.push(host.alias)
        return new Remote.Result({
          host: host.alias,
          status: host.alias === "lab-a" ? "ok" : "failed",
          exit: host.alias === "lab-a" ? 0 : 9,
          duration_ms: 10,
          stdout: host.alias === "lab-a" ? `${command}\n` : "",
          stderr: host.alias === "lab-b" ? "unavailable\n" : "",
          truncated: false,
        })
      }),
  }),
)
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(denied ? Effect.fail(new PermissionV2.BlockedError({ rules: [] })) : Effect.void),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const layer = AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, RemoteRunTool.node]), [
  [Remote.node, remote],
  [PermissionV2.node, permission],
  [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
])
const it = testEffect(layer)

function call(input: typeof RemoteRunTool.Input.Type) {
  return {
    sessionID,
    ...toolIdentity,
    call: {
      type: "tool-call" as const,
      id: "call-remote-run",
      name: RemoteRunTool.name,
      input,
    },
  }
}

function reset() {
  assertions.length = 0
  runs.length = 0
  denied = false
}

describe("RemoteRunTool", () => {
  it.effect("registers only when hosts exist and keeps requested result order", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service
      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual(["remote_run"])
      expect(yield* toolDefinitions(registry, [{ action: "remote_run", resource: "*", effect: "deny" }])).toEqual([])

      expect(
        yield* settleTool(registry, call({ hosts: ["lab-b", "lab-a"], command: "uname -a", concurrency: 2 })),
      ).toMatchObject({
        result: {
          type: "content",
          value: [
            { type: "text", text: "[lab-b] failed (exit 9)" },
            { type: "text", text: "stderr:\nunavailable\n" },
            { type: "text", text: "[lab-a] ok (exit 0)" },
            { type: "text", text: "uname -a\n" },
          ],
        },
        output: {
          structured: {
            command: "uname -a",
            results: [
              { host: "lab-b", status: "failed", exit: 9 },
              { host: "lab-a", status: "ok", exit: 0 },
            ],
          },
        },
      })
      expect(assertions).toMatchObject([
        {
          sessionID,
          action: "remote_run",
          resources: ["lab-b uname -a", "lab-a uname -a"],
          save: ["lab-b uname -a", "lab-a uname -a"],
          metadata: { hosts: ["lab-b", "lab-a"], command: "uname -a", concurrency: 2 },
        },
      ])
      expect(runs.toSorted()).toEqual(["lab-a", "lab-b"])
    }),
  )

  it.effect("resolves every host and obtains permission before any run starts", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service

      expect(yield* executeTool(registry, call({ hosts: ["lab-a", "missing"], command: "hostname" }))).toEqual({
        type: "error",
        value: "Unknown remote host: missing",
      })
      expect(assertions).toEqual([])
      expect(runs).toEqual([])

      denied = true
      expect(yield* executeTool(registry, call({ hosts: ["lab-a"], command: "hostname" }))).toEqual({
        type: "error",
        value: "Remote command was not approved",
      })
      expect(assertions).toHaveLength(1)
      expect(runs).toEqual([])
    }),
  )

  it.effect("rejects empty, duplicate, and oversized target lists before permission", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service
      expect(yield* executeTool(registry, call({ hosts: [], command: "true" }))).toEqual({
        type: "error",
        value: "At least one remote host is required",
      })
      expect(yield* executeTool(registry, call({ hosts: ["lab-a", "lab-a"], command: "true" }))).toEqual({
        type: "error",
        value: "Remote host aliases must be unique",
      })
      expect(
        yield* executeTool(
          registry,
          call({
            hosts: Array.from({ length: RemoteRunTool.MAX_HOSTS + 1 }, (_, index) => `host-${index}`),
            command: "true",
          }),
        ),
      ).toEqual({
        type: "error",
        value: `Remote host count may not exceed ${RemoteRunTool.MAX_HOSTS}`,
      })
      expect(assertions).toEqual([])
      expect(runs).toEqual([])
    }),
  )
})
