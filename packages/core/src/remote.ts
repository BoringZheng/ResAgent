export * as Remote from "./remote"

import path from "path"
import { Context, Duration, Effect, Layer, Schema, Semaphore } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Config } from "./config"
import { ConfigRemote } from "./config/remote"
import { makeLocationNode } from "./effect/app-node"
import { Global } from "./global"
import { AppProcess } from "./process"

export const DEFAULT_CONNECT_TIMEOUT_SECONDS = 10
export const DEFAULT_COMMAND_TIMEOUT_MS = 2 * 60 * 1_000
export const MAX_COMMAND_TIMEOUT_MS = 10 * 60 * 1_000
export const MAX_CAPTURE_BYTES = 512 * 1024

export interface Host {
  readonly alias: ConfigRemote.Alias
  readonly host: string
  readonly user?: string
  readonly port: number
  readonly identityFile?: string
  readonly knownHostsFile?: string
  readonly hostKey: "strict" | "accept-new"
  readonly proxyJump?: string
  readonly connectTimeout: number
  readonly commandTimeout: number
  readonly maxConcurrency: number
  readonly tags: ReadonlyArray<string>
}

export const Status = Schema.Literals(["ok", "failed", "timeout"])
export type Status = typeof Status.Type

export class Result extends Schema.Class<Result>("Remote.Result")({
  host: ConfigRemote.Alias,
  status: Status,
  exit: Schema.Number.pipe(Schema.optional),
  duration_ms: Schema.Number,
  stdout: Schema.String,
  stderr: Schema.String,
  truncated: Schema.Boolean,
}) {}

export class UnknownHostError extends Schema.TaggedErrorClass<UnknownHostError>()("Remote.UnknownHostError", {
  alias: Schema.String,
}) {
  override get message() {
    return `Unknown remote host: ${this.alias}`
  }
}

export interface Interface {
  readonly list: () => Effect.Effect<ReadonlyArray<Host>>
  readonly get: (alias: string) => Effect.Effect<Host, UnknownHostError>
  readonly run: (input: {
    readonly host: Host
    readonly command: string
    readonly timeout?: number
  }) => Effect.Effect<Result>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Remote") {}

type ConfiguredHost = Schema.Schema.Type<typeof ConfigRemote.Host>

export function load(entries: ReadonlyArray<Config.Entry>, home: string): ReadonlyMap<ConfigRemote.Alias, Host> {
  const configured = Object.assign(
    {} as Record<string, ConfiguredHost>,
    ...entries.flatMap((entry) =>
      entry.type === "document" ? [(entry.info.remotes ?? {}) as Record<string, ConfiguredHost>] : [],
    ),
  )
  return new Map(
    Object.keys(configured).map((alias) => {
      const item = configured[alias]!
      return [
        ConfigRemote.Alias.make(alias),
        {
          alias: ConfigRemote.Alias.make(alias),
          host: item.host,
          user: item.user,
          port: item.port ?? 22,
          identityFile: item.identity_file ? resolvePath(home, item.identity_file) : undefined,
          knownHostsFile: item.known_hosts_file ? resolvePath(home, item.known_hosts_file) : undefined,
          hostKey: item.host_key ?? "strict",
          proxyJump: item.proxy_jump,
          connectTimeout: item.connect_timeout ?? DEFAULT_CONNECT_TIMEOUT_SECONDS,
          commandTimeout: item.command_timeout ?? DEFAULT_COMMAND_TIMEOUT_MS,
          maxConcurrency: item.max_concurrency ?? 1,
          tags: item.tags ?? [],
        },
      ]
    }),
  )
}

export function argumentsFor(host: Host, command: string): ReadonlyArray<string> {
  return [
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
    `ConnectTimeout=${host.connectTimeout}`,
    "-o",
    `StrictHostKeyChecking=${host.hostKey === "strict" ? "yes" : "accept-new"}`,
    ...(host.knownHostsFile ? ["-o", `UserKnownHostsFile=${host.knownHostsFile}`] : []),
    ...(host.identityFile ? ["-o", "IdentitiesOnly=yes", "-i", host.identityFile] : []),
    ...(host.proxyJump ? ["-J", host.proxyJump] : []),
    "-p",
    String(host.port),
    "--",
    host.user ? `${host.user}@${host.host}` : host.host,
    command,
  ]
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const global = yield* Global.Service
    const process = yield* AppProcess.Service
    const hosts = load(yield* config.entries(), global.home)
    const limits = new Map(Array.from(hosts, ([alias, host]) => [alias, Semaphore.makeUnsafe(host.maxConcurrency)]))

    const get = Effect.fn("Remote.get")(function* (alias: string) {
      const host = hosts.get(ConfigRemote.Alias.make(alias))
      if (!host) return yield* new UnknownHostError({ alias })
      return host
    })

    const run = Effect.fn("Remote.run")(function* (input: {
      readonly host: Host
      readonly command: string
      readonly timeout?: number
    }) {
      const semaphore = limits.get(input.host.alias)
      if (!semaphore) return yield* Effect.die(`Missing concurrency limit for remote host: ${input.host.alias}`)
      return yield* semaphore.withPermit(
        Effect.gen(function* () {
          const started = Date.now()
          const timeout = Math.min(Math.max(1, input.timeout ?? input.host.commandTimeout), MAX_COMMAND_TIMEOUT_MS)
          const result = yield* process
            .run(
              ChildProcess.make("ssh", argumentsFor(input.host, input.command), {
                stdin: "ignore",
              }),
              {
                timeout: Duration.millis(timeout),
                maxOutputBytes: MAX_CAPTURE_BYTES,
                maxErrorBytes: MAX_CAPTURE_BYTES,
              },
            )
            .pipe(
              Effect.map(
                (result) =>
                  new Result({
                    host: input.host.alias,
                    status: result.exitCode === 0 ? "ok" : "failed",
                    exit: result.exitCode,
                    duration_ms: Date.now() - started,
                    stdout: redact(input.host, result.stdout.toString("utf8")),
                    stderr: redact(input.host, result.stderr.toString("utf8")),
                    truncated: result.stdoutTruncated || result.stderrTruncated,
                  }),
              ),
              Effect.catchTag("AppProcessError", (error) =>
                Effect.succeed(
                  new Result({
                    host: input.host.alias,
                    status: isTimeout(error) ? "timeout" : "failed",
                    exit: error.exitCode,
                    duration_ms: Date.now() - started,
                    stdout: "",
                    stderr: isTimeout(error)
                      ? `Command exceeded timeout of ${timeout} ms.`
                      : redact(input.host, error.stderr?.trim() || "SSH client failed before command completion."),
                    truncated: false,
                  }),
                ),
              ),
            )
          return result
        }),
      )
    })

    return Service.of({
      list: Effect.fn("Remote.list")(function* () {
        return [...hosts.values()]
      }),
      get,
      run,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, Global.node, AppProcess.node],
})

function resolvePath(home: string, value: string) {
  if (value === "~") return home
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.resolve(home, value.slice(2))
  return path.resolve(value)
}

function isTimeout(error: AppProcess.AppProcessError) {
  return error.cause instanceof Error && error.cause.message === "Timed out"
}

function redact(host: Host, value: string) {
  return [host.identityFile, host.knownHostsFile]
    .filter((item): item is string => item !== undefined)
    .reduce((result, item) => result.replaceAll(item, "<redacted-path>"), value)
}
