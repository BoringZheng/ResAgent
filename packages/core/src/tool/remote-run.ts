export * as RemoteRunTool from "./remote-run"

import { Effect, Layer, Schema } from "effect"
import { ToolFailure } from "@opencode-ai/llm"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { PositiveInt } from "../schema"
import { Remote } from "../remote"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "remote_run"
export const DEFAULT_CONCURRENCY = 4
export const MAX_HOSTS = 32

export const Input = Schema.Struct({
  hosts: Schema.Array(Schema.String).annotate({ description: "Configured remote host aliases" }),
  command: Schema.NonEmptyString.annotate({ description: "Command interpreted by each remote account's login shell" }),
  timeout: PositiveInt.check(Schema.isLessThanOrEqualTo(Remote.MAX_COMMAND_TIMEOUT_MS))
    .pipe(Schema.optional)
    .annotate({ description: "Per-host timeout in milliseconds" }),
  concurrency: PositiveInt.check(Schema.isLessThanOrEqualTo(16))
    .pipe(Schema.optional)
    .annotate({ description: "Maximum number of target hosts to run concurrently" }),
})

const Output = Schema.Struct({
  command: Schema.String,
  results: Schema.Array(Remote.Result),
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const remote = yield* Remote.Service
    const permission = yield* PermissionV2.Service
    const available = yield* remote.list()
    if (available.length === 0) return

    yield* tools
      .register({
        [name]: Tool.make({
          description: `Run one command on configured SSH hosts. Every host alias and the exact command require permission before any connection starts. Results remain in requested host order and include independent failures. Configured hosts: ${available.map((host) => host.alias).join(", ")}.`,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) =>
            output.results.flatMap((result) => [
              {
                type: "text" as const,
                text: `[${result.host}] ${result.status}${result.exit === undefined ? "" : ` (exit ${result.exit})`}`,
              },
              ...(result.stdout ? [{ type: "text" as const, text: result.stdout }] : []),
              ...(result.stderr ? [{ type: "text" as const, text: `stderr:\n${result.stderr}` }] : []),
            ]),
          execute: (input, context) =>
            Effect.gen(function* () {
              if (input.hosts.length === 0) {
                return yield* new ToolFailure({ message: "At least one remote host is required" })
              }
              if (input.hosts.length > MAX_HOSTS) {
                return yield* new ToolFailure({ message: `Remote host count may not exceed ${MAX_HOSTS}` })
              }
              const aliases = [...new Set(input.hosts)]
              if (aliases.length !== input.hosts.length) {
                return yield* new ToolFailure({ message: "Remote host aliases must be unique" })
              }
              const hosts = yield* Effect.forEach(aliases, (alias) =>
                remote.get(alias).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message }))),
              )
              const resources = aliases.map((alias) => `${alias} ${input.command}`)
              yield* permission.assert({
                action: name,
                resources,
                save: resources,
                sessionID: context.sessionID,
                agent: context.agent,
                source: {
                  type: "tool",
                  messageID: context.assistantMessageID,
                  callID: context.toolCallID,
                },
                metadata: {
                  hosts: aliases,
                  command: input.command,
                  timeout: input.timeout,
                  concurrency: input.concurrency ?? DEFAULT_CONCURRENCY,
                },
              })
              const results = yield* Effect.forEach(
                hosts,
                (host) => remote.run({ host, command: input.command, timeout: input.timeout }),
                { concurrency: input.concurrency ?? DEFAULT_CONCURRENCY },
              )
              return { command: input.command, results }
            }).pipe(Effect.mapError(remoteFailure)),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/remote-run",
  layer,
  deps: [ToolRegistry.node, Remote.node, PermissionV2.node],
})

function remoteFailure(error: unknown) {
  if (error instanceof ToolFailure) return error
  if (error instanceof PermissionV2.CorrectedError) return new ToolFailure({ message: error.feedback })
  if (error instanceof PermissionV2.BlockedError) return new ToolFailure({ message: "Remote command was not approved" })
  return new ToolFailure({ message: error instanceof Error ? error.message : "Unable to execute remote command" })
}
