import type { Argv } from "yargs"
import { EOL } from "os"
import * as prompts from "@clack/prompts"
import { Effect, Fiber, Schema, Stream } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ResearchRun } from "@opencode-ai/core/research-run"
import { ResearchWorkflow } from "@opencode-ai/core/research-workflow"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { SessionV2 } from "@opencode-ai/core/session"
import { CliError, effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"

export function resolveQuestion(positional: ReadonlyArray<string>, piped?: string) {
  return [positional.join(" ").trim(), piped?.trim()]
    .filter((part): part is string => Boolean(part))
    .join("\n\n")
    .trim()
}

export function formatToolProgress(tool: string, input: unknown) {
  if (tool !== "remote_run") return `tool · ${tool}`
  const hosts =
    typeof input === "object" && input !== null && "hosts" in input
      ? (input as { readonly hosts?: unknown }).hosts
      : undefined
  return `remote · ${Array.isArray(hosts) ? hosts.filter((host) => typeof host === "string").join(", ") : "configured targets"}`
}

export const ResearchCommand = effectCmd({
  command: "research [question..]",
  describe: "run a durable multi-provider research workflow",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("question", {
        describe: "research question",
        type: "string",
        array: true,
        default: [],
      })
      .option("profile", {
        alias: ["p"],
        describe: "research profile",
        type: "string",
      })
      .option("output", {
        alias: ["o"],
        describe: "report path inside the current directory",
        type: "string",
      })
      .option("session", {
        alias: ["s"],
        describe: "continue a V2 session in the current directory",
        type: "string",
      })
      .option("continue", {
        alias: ["c"],
        describe: "reuse the newest V2 session in the current directory",
        type: "boolean",
      })
      .option("resume", {
        describe: "continue the selected session's failed research run instead of starting one",
        type: "string",
      })
      .option("review-plan", {
        describe: "print the plan and wait for approval before collecting",
        type: "boolean",
      })
      .conflicts("session", "continue"),
  handler: Effect.fn("Cli.research")(function* (args) {
    const command = Effect.gen(function* () {
      // `--resume` takes an optional run identifier, so an empty string means the flag was given
      // without one and the session's newest run is the one to continue.
      const resuming = args.resume !== undefined
      const piped = process.stdin.isTTY ? undefined : yield* Effect.promise(() => Bun.stdin.text())
      const question = resolveQuestion(args.question, piped)
      if (!question && !resuming) return yield* fail("You must provide a research question")
      const runID = args.resume
        ? yield* Schema.decodeUnknownEffect(ResearchRun.ID)(args.resume).pipe(
            Effect.mapError(() => new CliError({ message: `Invalid research run ID: ${args.resume}` })),
          )
        : undefined

      const sessions = yield* SessionV2.Service
      const workflow = yield* ResearchWorkflow.Service
      const events = yield* EventV2.Service
      const location = Location.Ref.make({ directory: AbsolutePath.make(process.cwd()) })
      // A resumed run lives in a session that already exists, so resuming never creates one: an
      // empty session has nothing to resume and would fail with a less useful message.
      const newest = Effect.gen(function* () {
        const found = (yield* sessions.list({ directory: location.directory, order: "desc", limit: 1 }))[0]
        if (found) return found
        if (resuming) return yield* fail("No session in the current directory has a research run to resume")
        return yield* sessions.create({ location })
      })
      const selected = args.session
        ? yield* Schema.decodeUnknownEffect(SessionV2.ID)(args.session).pipe(
            Effect.mapError(() => new CliError({ message: `Invalid session ID: ${args.session}` })),
            Effect.flatMap((sessionID) => sessions.get(sessionID)),
          )
        : args.continue || resuming
          ? yield* newest
          : yield* sessions.create({ location })
      if (selected.location.directory !== location.directory || selected.location.workspaceID !== location.workspaceID)
        return yield* fail(`Session ${selected.id} belongs to a different location`)

      const started = events.subscribe(SessionEvent.Research.Started).pipe(
        Stream.filter((event) => event.data.sessionID === selected.id),
        Stream.map((event) => `research ${event.data.runID} · profile ${event.data.profile}`),
      )
      const stages = events.subscribe(SessionEvent.Research.StageStarted).pipe(
        Stream.filter((event) => event.data.sessionID === selected.id),
        Stream.map((event) => `stage ${event.data.stage} · role ${event.data.role}`),
      )
      const attempts = events.subscribe(SessionEvent.Research.ProviderAttempted).pipe(
        Stream.filter((event) => event.data.sessionID === selected.id),
        Stream.map((event) => `provider ${event.data.attempt} · ${event.data.entry}`),
      )
      const toolCalls = events.subscribe(SessionEvent.Tool.Called).pipe(
        Stream.filter((event) => event.data.sessionID === selected.id),
        Stream.map((event) => formatToolProgress(event.data.tool, event.data.input)),
      )
      const progress = Stream.merge(started, stages).pipe(
        Stream.merge(attempts),
        Stream.merge(toolCalls),
        Stream.runForEach((line) => Effect.sync(() => UI.println(UI.Style.TEXT_DIM + line + UI.Style.TEXT_NORMAL))),
      )
      const progressFiber = yield* Effect.forkScoped(progress)
      yield* Effect.yieldNow
      /**
       * The opt-in gate. It only ever approves or declines: an edited plan is part of the workflow
       * contract for API callers, but there is no terminal editor here to produce one.
       */
      const review = (plan: Readonly<Record<string, unknown>>) =>
        Effect.promise(async (): Promise<ResearchWorkflow.PlanReview> => {
          UI.println("", UI.Style.TEXT_HIGHLIGHT_BOLD + "Plan" + UI.Style.TEXT_NORMAL)
          UI.println(JSON.stringify(plan, undefined, 2))
          const answer = await prompts.confirm({ message: "Collect evidence against this plan?" })
          if (prompts.isCancel(answer)) return { approved: false, reason: "review cancelled" }
          return answer ? { approved: true } : { approved: false, reason: "declined at review" }
        })
      const result = yield* workflow
        .run({
          sessionID: selected.id,
          question,
          profile: args.profile,
          path: args.output,
          ...(resuming ? { resume: true } : {}),
          ...(runID ? { runID } : {}),
          ...(args["review-plan"] ? { review } : {}),
        })
        .pipe(Effect.ensuring(Fiber.interrupt(progressFiber)))

      UI.println(
        UI.Style.TEXT_SUCCESS_BOLD + "Report" + UI.Style.TEXT_NORMAL,
        result.path,
        UI.Style.TEXT_DIM + `session ${selected.id}` + UI.Style.TEXT_NORMAL,
      )
      process.stdout.write(result.report.trimEnd() + EOL)
    }).pipe(
      Effect.scoped,
      Effect.mapError((error) =>
        error instanceof CliError
          ? error
          : new CliError({ message: error instanceof Error ? error.message : String(error) }),
      ),
    )
    return yield* command
  }),
})
