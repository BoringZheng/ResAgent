import { EOL } from "os"
import path from "path"
import { Effect, Exit } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { ConfigProviderPlugin } from "@opencode-ai/core/config/plugin/provider"
import { ConfigResearch } from "@opencode-ai/core/config/research"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { Remote } from "@opencode-ai/core/remote"
import { ResearchRoute } from "@opencode-ai/core/research-route"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { which } from "@opencode-ai/core/util/which"
import { CliError, effectCmd, fail } from "../effect-cmd"

type Check = {
  readonly status: "ok" | "warn" | "fail"
  readonly label: string
  readonly detail: string
}

export function renderChecks(checks: ReadonlyArray<Check>) {
  return checks.map((check) => `[${check.status}] ${check.label}: ${check.detail}`).join(EOL)
}

export const DoctorCommand = effectCmd({
  command: "doctor",
  describe: "check research providers, SSH targets, and report export",
  instance: false,
  handler: Effect.fn("Cli.doctor")(function* () {
    const command = Effect.gen(function* () {
      const locations = yield* LocationServiceMap.Service
      const location = Location.Ref.make({ directory: AbsolutePath.make(process.cwd()) })
      const checks = yield* Effect.gen(function* () {
        const plugins = yield* PluginV2.Service
        yield* plugins.wait(PluginV2.ID.make("config-provider"))
        yield* ConfigProviderPlugin.Plugin.effect(yield* PluginHost.make(plugins))
        const catalog = yield* Catalog.Service
        const routes = yield* ResearchRoute.Service
        const remotes = yield* Remote.Service
        const fs = yield* FSUtil.Service
        const result: Check[] = []

        const providers = yield* catalog.provider.available()
        const models = yield* catalog.model.available()
        result.push({
          status: providers.length && models.length ? "ok" : "fail",
          label: "providers",
          detail: `${providers.length} available provider(s), ${models.length} available model(s)`,
        })

        const selected = yield* routes.get().pipe(Effect.exit)
        if (Exit.isFailure(selected)) {
          result.push({
            status: "fail",
            label: "research profile",
            detail: errorMessage(selected.cause),
          })
        }
        if (Exit.isSuccess(selected)) {
          result.push({ status: "ok", label: "research profile", detail: selected.value.name })
          for (const role of ConfigResearch.Role.literals) {
            const route = yield* routes.route({ profile: selected.value.name, role }).pipe(Effect.exit)
            result.push(
              Exit.isFailure(route)
                ? { status: "fail", label: `route ${role}`, detail: errorMessage(route.cause) }
                : {
                    status: "ok",
                    label: `route ${role}`,
                    detail: route.value.candidates.map((candidate) => candidate.entry).join(" -> "),
                  },
            )
          }
        }

        const ssh = which("ssh")
        const version = ssh
          ? yield* Effect.sync(() => {
              const process = Bun.spawnSync([ssh, "-V"], { stdout: "pipe", stderr: "pipe" })
              return `${process.stdout.toString()}${process.stderr.toString()}`.trim().split(/\r?\n/)[0]
            })
          : undefined
        result.push({
          status: ssh ? "ok" : "fail",
          label: "OpenSSH",
          detail: version || "ssh client not found on PATH",
        })

        const hosts = yield* remotes.list()
        if (hosts.length === 0) {
          result.push({ status: "warn", label: "remote hosts", detail: "none configured" })
        }
        for (const host of hosts) {
          const identity = host.identityFile ? yield* fs.isFile(host.identityFile) : undefined
          const knownHosts = host.knownHostsFile ? yield* fs.isFile(host.knownHostsFile) : undefined
          const missing = identity === false || knownHosts === false
          result.push({
            status: missing ? "fail" : host.hostKey === "strict" ? "ok" : "warn",
            label: `remote ${host.alias}`,
            detail: [
              `host-key=${host.hostKey}`,
              `identity=${identity === undefined ? "default" : identity ? "present" : "missing"}`,
              `known-hosts=${knownHosts === undefined ? "default" : knownHosts ? "present" : "missing"}`,
              `timeout=${host.commandTimeout}ms`,
              `concurrency=${host.maxConcurrency}`,
            ].join(", "),
          })
        }

        const reportDirectory = path.join(location.directory, ".resagent", "reports")
        const probe = path.join(reportDirectory, `.doctor-${process.pid}-${crypto.randomUUID()}.tmp`)
        const writable = yield* fs
          .writeWithDirs(probe, "doctor")
          .pipe(Effect.ensuring(fs.remove(probe).pipe(Effect.ignore)), Effect.exit)
        result.push({
          status: Exit.isSuccess(writable) ? "ok" : "fail",
          label: "report directory",
          detail: Exit.isSuccess(writable) ? "writable" : errorMessage(writable.cause),
        })
        return result
      }).pipe(Effect.provide(locations.get(location)), Effect.scoped)

      process.stdout.write(renderChecks(checks) + EOL)
      const failures = checks.filter((check) => check.status === "fail")
      if (failures.length) return yield* fail(`Doctor found ${failures.length} failing check(s).`)
    })
    return yield* command
  }),
})

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (
    typeof error === "object" &&
    error !== null &&
    "reasons" in error &&
    Array.isArray(error.reasons) &&
    error.reasons.length
  ) {
    const reason = error.reasons[0]
    if (typeof reason === "object" && reason !== null && "error" in reason && reason.error instanceof Error)
      return reason.error.message
  }
  return String(error)
}
