export * as ResearchWorkflow from "./research-workflow"

import { Context, Effect, Layer, Schema } from "effect"
import path from "path"
import { ConfigProviderPlugin } from "./config/plugin/provider"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { KeyedMutex } from "./effect/keyed-mutex"
import { FileMutation } from "./file-mutation"
import { FSUtil } from "./fs-util"
import { LocationMutation } from "./location-mutation"
import { LocationServiceMap } from "./location-service-map"
import type { LocationError } from "./location-services"
import { PluginV2 } from "./plugin"
import { PluginHost } from "./plugin/host"
import { ResearchRoute } from "./research-route"
import { ResearchRun } from "./research-run"
import { SessionV2 } from "./session"
import { SessionMessage } from "./session/message"
import { Prompt } from "./session/prompt"
import { SessionRunner } from "./session/runner"
import { SessionSchema } from "./session/schema"
import { SessionInput } from "./session/input"

const stages = [
  { stage: "plan", role: "planner" },
  { stage: "collect", role: "collector" },
  { stage: "analyze", role: "analyst" },
  { stage: "verify", role: "verifier" },
  { stage: "report", role: "writer" },
] as const

export class ActiveRunError extends Schema.TaggedErrorClass<ActiveRunError>()("ResearchWorkflow.ActiveRunError", {
  sessionID: SessionSchema.ID,
  runID: ResearchRun.ID,
}) {
  override get message() {
    return `Research run ${this.runID} is already active for session ${this.sessionID}`
  }
}

export class InvalidQuestionError extends Schema.TaggedErrorClass<InvalidQuestionError>()(
  "ResearchWorkflow.InvalidQuestionError",
  {},
) {
  override get message() {
    return "Research question must not be empty."
  }
}

export class StageFailedError extends Schema.TaggedErrorClass<StageFailedError>()("ResearchWorkflow.StageFailedError", {
  stage: Schema.String,
  message: Schema.String,
}) {}

export class ExportPathError extends Schema.TaggedErrorClass<ExportPathError>()("ResearchWorkflow.ExportPathError", {
  path: Schema.String,
}) {
  override get message() {
    return `Research reports must be written inside the active location: ${this.path}`
  }
}

export class SessionBusyError extends Schema.TaggedErrorClass<SessionBusyError>()("ResearchWorkflow.SessionBusyError", {
  sessionID: SessionSchema.ID,
}) {
  override get message() {
    return `Session ${this.sessionID} has active or queued work; research requires an idle session`
  }
}

export interface Result {
  readonly run: ResearchRun.Info
  readonly report: string
  readonly path: string
}

export type Error =
  | ActiveRunError
  | InvalidQuestionError
  | StageFailedError
  | ExportPathError
  | SessionBusyError
  | ResearchRoute.Error
  | ResearchRun.NotFoundError
  | ResearchRun.RunMismatchError
  | ResearchRun.InvalidHistoryError
  | ResearchRun.InvalidTransitionError
  | ResearchRun.IndeterminateAttemptError
  | SessionV2.NotFoundError
  | SessionV2.PromptConflictError
  | SessionV2.ResearchActiveError
  | SessionV2.MessageDecodeError
  | SessionRunner.RunError
  | LocationMutation.PathError
  | FSUtil.Error
  | LocationError

export interface Interface {
  readonly run: (input: {
    readonly sessionID: SessionSchema.ID
    readonly question: string
    readonly profile?: string
    readonly path?: string
  }) => Effect.Effect<Result, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ResearchWorkflow") {}

type StageOutput = {
  readonly stage: ResearchRun.Stage
  readonly message: SessionMessage.Assistant
  readonly messages?: ReadonlyArray<SessionMessage.Assistant>
}

export function prompt(stage: ResearchRun.Stage, question: string, outputs: ReadonlyArray<StageOutput> = []) {
  const instructions = {
    plan: "Produce a concise research plan with subquestions, evidence requirements, and target source types. Return the plan directly instead of writing it to a file.",
    collect:
      "Collect evidence using available tools. Preserve source URLs, file paths, remote host aliases, commands, and important output details. Do not write the evidence to a file. Stop using tools once you have sufficient evidence and return the complete evidence summary directly.",
    analyze:
      "Analyze the collected evidence, normalize comparable facts, and identify material conflicts or uncertainty.",
    verify:
      "Challenge unsupported claims, check conflicting evidence, and state which conclusions remain uncertain or conditional.",
    report:
      "Write the final Markdown report with conclusions, citations, confidence notes, limitations, and no surrounding code fence. The report must directly answer the research question.",
  } satisfies Record<ResearchRun.Stage, string>
  const prior = outputs
    .map((output) => `## ${output.stage}\n\n${assistantText(output.message).slice(0, 12_000)}`)
    .join("\n\n")
  const mode =
    stage === "collect"
      ? "Use only evidence-gathering tools. Return the stage result as Markdown text after gathering enough evidence."
      : "Tools are unavailable for this stage. Return the stage result directly as Markdown text. Do not emit tool-call markup, XML, DSML, JSON protocols, or requests to read or write files."
  return [
    `[ResAgent research stage: ${stage}]`,
    "",
    "Research question:",
    question,
    "",
    "Complete this stage autonomously. Do not ask the user questions or wait for user input.",
    mode,
    "",
    instructions[stage],
    ...(prior ? ["", "Prior stage results:", "", prior] : []),
  ].join("\n")
}

export function stageOutputMessageID(run: ResearchRun.Info, stage: ResearchRun.Stage) {
  const item = run.stages.find((entry) => entry.stage === stage)
  return (
    item?.attempts.findLast((attempt) => attempt.status === "succeeded" && attempt.messageID !== undefined)
      ?.messageID ?? item?.messageID
  )
}

export function usableStageOutput(stage: ResearchRun.Stage, message: SessionMessage.Assistant) {
  const text = assistantText(message).trim()
  if (!text || /\bdsml\b|tool_calls|<tool-call|<invoke\b/i.test(text)) return false
  return true
}

export function render(input: { readonly run: ResearchRun.Info; readonly outputs: ReadonlyArray<StageOutput> }) {
  const reportOutput = input.outputs.find((output) => output.stage === "report")
  const report = reportOutput ? assistantText(reportOutput.message).trim() : undefined
  if (!report) return
  const provenance = input.outputs.map((output) => {
    const stage = input.run.stages.find((item) => item.stage === output.stage)
    const attempts = stage?.attempts.length
      ? stage.attempts.map((attempt) => `  - ${attempt.attempt}: \`${attempt.entry}\``).join("\n")
      : "  - None recorded"
    const tools = (output.messages ?? [output.message]).flatMap((message) =>
      message.content.filter((part) => part.type === "tool"),
    )
    const toolLines = tools.length
      ? tools
          .map((tool) => {
            const input =
              tool.state.status === "pending" ? tool.state.input : JSON.stringify(tool.state.input).slice(0, 2_000)
            return `  - \`${tool.name}\` (${tool.state.status}): \`${input.replaceAll("`", "\\`")}\``
          })
          .join("\n")
      : "  - None"
    return [
      `### ${output.stage}`,
      "",
      `- Selected model: \`${output.message.model.providerID}/${output.message.model.id}\``,
      "- Provider attempts:",
      attempts,
      "- Tool calls:",
      toolLines,
    ].join("\n")
  })
  return [
    report,
    "",
    "## Provenance",
    "",
    `- Research run: \`${input.run.id}\``,
    `- Profile: \`${input.run.profile}\``,
    `- Session: \`${input.run.sessionID}\``,
    "",
    ...provenance,
    "",
  ].join("\n")
}

function assistantText(message: SessionMessage.Assistant) {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service
    const research = yield* ResearchRun.Service
    const locations = yield* LocationServiceMap.Service
    const db = (yield* Database.Service).db
    const locks = KeyedMutex.makeUnsafe<SessionSchema.ID>()

    const stageOutput = Effect.fn("ResearchWorkflow.stageOutput")(function* (
      sessionID: SessionSchema.ID,
      stage: ResearchRun.Stage,
    ) {
      const current = yield* research.current(sessionID)
      const messageID = current ? stageOutputMessageID(current, stage) : undefined
      const message = messageID ? yield* sessions.message({ sessionID, messageID }) : undefined
      if (message?.type !== "assistant")
        return yield* new StageFailedError({
          stage,
          message: "Provider turn completed without a durable assistant message.",
        })
      if (message.finish === "error")
        return yield* new StageFailedError({
          stage,
          message: message.error?.message ?? "Provider turn failed.",
        })
      return message
    })

    const stageMessages = Effect.fn("ResearchWorkflow.stageMessages")(function* (
      sessionID: SessionSchema.ID,
      run: ResearchRun.Info,
      stage: ResearchRun.Stage,
    ) {
      const messageIDs =
        run.stages
          .find((item) => item.stage === stage)
          ?.attempts.flatMap((attempt) =>
            attempt.status === "succeeded" && attempt.messageID ? [attempt.messageID] : [],
          ) ?? []
      return yield* Effect.forEach(messageIDs, (messageID) =>
        sessions
          .message({ sessionID, messageID })
          .pipe(Effect.map((message) => (message?.type === "assistant" ? message : undefined))),
      ).pipe(Effect.map((messages) => messages.filter((message) => message !== undefined)))
    })

    const run = Effect.fn("ResearchWorkflow.run")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly question: string
      readonly profile?: string
      readonly path?: string
    }) {
      if (input.question.trim().length === 0) return yield* new InvalidQuestionError()
      return yield* locks.withLock(input.sessionID)(
        Effect.gen(function* () {
          const existing = yield* research.current(input.sessionID)
          if (existing?.status === "active")
            return yield* new ActiveRunError({
              sessionID: input.sessionID,
              runID: existing.id,
            })
          if (
            (yield* sessions.active).has(input.sessionID) ||
            (yield* SessionInput.hasPending(db, input.sessionID, "steer")) ||
            (yield* SessionInput.hasPending(db, input.sessionID, "queue"))
          )
            return yield* new SessionBusyError({ sessionID: input.sessionID })
          const session = yield* sessions.get(input.sessionID)
          const location = locations.get(session.location)
          const execute = Effect.gen(function* () {
            const plugins = yield* PluginV2.Service
            yield* plugins.wait(PluginV2.ID.make("config-provider"))
            yield* ConfigProviderPlugin.Plugin.effect(yield* PluginHost.make(plugins))
            const routes = yield* ResearchRoute.Service
            const selected = yield* routes.get(input.profile)
            const started = yield* research.start({
              sessionID: input.sessionID,
              profile: selected.name,
              question: input.question.trim(),
            })
            const outputs: StageOutput[] = []
            const workflow = Effect.gen(function* () {
              for (const item of stages) {
                const route = selected.profile[item.role]
                yield* routes.route({ profile: selected.name, role: item.role })
                yield* research.startStage({
                  sessionID: input.sessionID,
                  runID: started.id,
                  stage: item.stage,
                  role: item.role,
                  route,
                })
                let assistant: SessionMessage.Assistant | undefined
                for (const correction of item.stage === "collect" ? [false] : [false, true]) {
                  yield* sessions.prompt({
                    sessionID: input.sessionID,
                    prompt: Prompt.make({
                      text: correction
                        ? `${prompt(item.stage, started.question, outputs)}\n\nThe previous response was not a usable stage result. Correct it now and return only the requested Markdown text.`
                        : prompt(item.stage, started.question, outputs),
                    }),
                    resume: false,
                    researchRunID: started.id,
                  })
                  yield* sessions.resume(input.sessionID)
                  assistant = yield* stageOutput(input.sessionID, item.stage)
                  if (usableStageOutput(item.stage, assistant)) break
                }
                if (!assistant || !usableStageOutput(item.stage, assistant))
                  return yield* new StageFailedError({
                    stage: item.stage,
                    message: "Provider returned tool protocol or insufficient Markdown instead of a stage result.",
                  })
                const current = (yield* research.current(input.sessionID))!
                const messages = yield* stageMessages(input.sessionID, current, item.stage)
                outputs.push({
                  stage: item.stage,
                  message: assistant,
                  ...(messages.length > 0 ? { messages } : {}),
                })
                yield* research.completeStage({
                  sessionID: input.sessionID,
                  runID: started.id,
                  stage: item.stage,
                  messageID: assistant.id,
                })
              }
              const current = (yield* research.current(input.sessionID))!
              const report = render({ run: current, outputs })
              if (!report)
                return yield* new StageFailedError({
                  stage: "report",
                  message: "Writer returned no report text.",
                })
              const requested = input.path ?? path.join(".resagent", "reports", `${started.id}.md`)
              const mutation = yield* LocationMutation.Service
              const target = yield* mutation.resolve({ path: requested, kind: "file" })
              if (target.externalDirectory) return yield* new ExportPathError({ path: requested })
              const files = yield* FileMutation.Service
              yield* files.writeTextPreservingBom({ target, content: report })
              yield* research.complete({
                sessionID: input.sessionID,
                runID: started.id,
                reportPath: target.resource,
              })
              return {
                run: (yield* research.current(input.sessionID))!,
                report,
                path: target.resource,
              }
            })
            return yield* workflow.pipe(
              Effect.tapError((error) =>
                research
                  .fail({
                    sessionID: input.sessionID,
                    runID: started.id,
                    message: error instanceof Error ? error.message : String(error),
                  })
                  .pipe(Effect.catch(() => Effect.void)),
              ),
            )
          })
          return yield* execute.pipe(Effect.provide(location), Effect.scoped)
        }),
      )
    })

    return Service.of({ run })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [SessionV2.node, ResearchRun.node, LocationServiceMap.node, Database.node],
})
