export * as ResearchWorkflow from "./research-workflow"

import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
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
import { ResearchBudget } from "./research-budget"
import { ResearchEvidence } from "./research-evidence"
import { ResearchRoute } from "./research-route"
import { ResearchRun } from "./research-run"
import { ResearchSchema } from "./research-schema"
import { SessionV2 } from "./session"
import { SessionMessage } from "./session/message"
import { Prompt } from "./session/prompt"
import { SessionRunner } from "./session/runner"
import { SessionSchema } from "./session/schema"
import { SessionInput } from "./session/input"
import { ResearchStageTool } from "./tool/research-stage"

const stages = [
  { stage: "plan", role: "planner" },
  { stage: "collect", role: "collector" },
  { stage: "analyze", role: "analyst" },
  { stage: "verify", role: "verifier" },
  { stage: "report", role: "writer" },
] as const

function order(stage: ResearchRun.Stage) {
  return stages.findIndex((item) => item.stage === stage)
}

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

/**
 * The run stopped at a stated ceiling. It is checked before a stage round rather than during one,
 * so the run fails between turns with its evidence and completed stages intact and can be resumed
 * once the ceiling is raised.
 */
export class BudgetExceededError extends Schema.TaggedErrorClass<BudgetExceededError>()(
  "ResearchWorkflow.BudgetExceededError",
  {
    stage: Schema.String,
    limit: Schema.Literals(["cost", "tokens"]),
    spent: Schema.Number,
    allowed: Schema.Number,
  },
) {
  override get message() {
    return `Research stopped before ${this.stage}: the run has spent ${this.spent} of its ${this.allowed} ${this.limit} budget. Raise \`research.budget\` and resume.`
  }
}

/** The reviewer declined the plan. The run keeps its plan, so a resumed run starts from collection. */
export class PlanRejectedError extends Schema.TaggedErrorClass<PlanRejectedError>()(
  "ResearchWorkflow.PlanRejectedError",
  {
    reason: Schema.String,
  },
) {
  override get message() {
    return `The research plan was not approved: ${this.reason}`
  }
}

export interface Result {
  readonly run: ResearchRun.Info
  readonly report: string
  readonly path: string
}

/**
 * The verdict on a generated plan. Returning an edited plan replaces the generated one, which the
 * run records durably, so the collection stage works from what was approved rather than what was
 * proposed.
 */
export type PlanReview =
  | { readonly approved: true; readonly plan?: Readonly<Record<string, unknown>> }
  | { readonly approved: false; readonly reason: string }

export type Error =
  | ActiveRunError
  | InvalidQuestionError
  | StageFailedError
  | ExportPathError
  | SessionBusyError
  | BudgetExceededError
  | PlanRejectedError
  | ResearchRoute.Error
  | ResearchRun.NotFoundError
  | ResearchRun.RunMismatchError
  | ResearchRun.InvalidHistoryError
  | ResearchRun.InvalidTransitionError
  | ResearchRun.IndeterminateAttemptError
  | ResearchRun.ResumeUnavailableError
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
    /** Required for a new run; a resumed run keeps the question it was started with. */
    readonly question?: string
    readonly profile?: string
    readonly path?: string
    /** Continue this session's newest run instead of starting one. The run must have failed. */
    readonly resume?: boolean
    /** Refuses to resume anything but this run. Omitted, the session's newest run is resumed. */
    readonly runID?: ResearchRun.ID
    /** Opt-in gate between plan and collect. Omitted, the run is fully automatic. */
    readonly review?: (plan: Readonly<Record<string, unknown>>) => Effect.Effect<PlanReview>
  }) => Effect.Effect<Result, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ResearchWorkflow") {}

type StageOutput = {
  readonly stage: ResearchRun.Stage
  readonly result: ResearchSchema.StageResult
  readonly messages: ReadonlyArray<SessionMessage.Assistant>
}

/**
 * What a stage is given to work with. Every field comes from the run's durable events rather than
 * from the message history, so a compacted session loses none of it.
 */
export interface StageContext {
  readonly plan?: Readonly<Record<string, unknown>>
  readonly evidence?: ReadonlyArray<ResearchEvidence.Evidence>
  readonly results?: ReadonlyArray<{
    readonly stage: ResearchRun.Stage
    readonly result: ResearchSchema.StageResult
  }>
  /** The round this stage is running, counting from one. Above one, the stage was reopened. */
  readonly round?: number
  /** The unmet requirements a reopened round exists to close. */
  readonly focus?: ReadonlyArray<ResearchSchema.Gap>
  /** What this stage submitted in its previous round, so a rerun extends rather than restarts. */
  readonly previous?: ResearchSchema.StageResult
  /** Set for a subcollector: the requirements of its bucket, which are all it is asked to close. */
  readonly assigned?: ReadonlyArray<ResearchSchema.Requirement>
  /** Set for the collect turn that follows a fan-out: what each subcollector reported. */
  readonly subcollected?: ReadonlyArray<ResearchSchema.Collect>
}

export function prompt(stage: ResearchRun.Stage, question: string, context: StageContext = {}) {
  const instructions = {
    plan: "Produce a concise research plan: the subquestions to answer, and for each one the evidence requirements that decide when it is satisfied. Use the read-only tools to check what sources actually exist before committing to a requirement.",
    collect:
      "Collect evidence for every requirement in the plan using the available tools. Preserve source URLs, file paths, remote host aliases, and commands. Stop using tools once you have sufficient evidence for each requirement, then report a coverage verdict for all of them.",
    analyze:
      "Analyze the collected evidence, normalize comparable facts, and identify material conflicts or uncertainty. Every finding must cite the evidence identifiers it rests on.",
    verify:
      "Challenge unsupported claims, check conflicting evidence, and state which conclusions remain uncertain or conditional. Read the stored evidence before ruling on a claim.",
    report:
      "Write the final Markdown report with conclusions, citations, confidence notes, limitations, and no surrounding code fence. The report must directly answer the research question.",
  } satisfies Record<ResearchRun.Stage, string>
  const submit = ResearchStageTool.stageTools[stage]
  const mode =
    stage === "plan"
      ? `Use only the read-only reconnaissance tools, then call \`${submit}\` exactly once to finish this stage.`
      : stage === "collect"
        ? `Use only evidence-gathering tools, then call \`${submit}\` exactly once to finish this stage.`
        : `No gathering tools are available. Read stored evidence with \`${ResearchStageTool.evidenceName}\`${
            stage === "verify"
              ? `, retrieve a recorded source again with \`${ResearchStageTool.recheckName}\` when a claim turns on whether it still says what it said`
              : ""
          }, then call \`${submit}\` exactly once to finish this stage.`
  const round =
    context.round !== undefined && context.round > 1
      ? `This is round ${context.round} of this stage: it was reopened because requirements were left unmet. Close the gaps listed below and keep what already held.`
      : undefined
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
    ...(round ? ["", round] : []),
    ...section("Plan", context.plan ? fence(context.plan) : undefined),
    ...section(
      "Requirements assigned to you",
      context.assigned?.length
        ? [
            "Gather evidence for these requirements only. Another collector is working on the rest,",
            "so do not gather for anything absent from this list, and report coverage for exactly it.",
            "",
            fence(context.assigned),
          ].join("\n")
        : undefined,
    ),
    ...section(
      "What your subcollectors reported",
      context.subcollected?.length
        ? [
            `Collection was split across ${context.subcollected.length} sessions, which have finished.`,
            "Their evidence is already in the index below. Report the combined coverage across every",
            "requirement in the plan; gather again only where they left a requirement unmet.",
            "",
            fence(context.subcollected),
          ].join("\n")
        : undefined,
    ),
    ...section(
      "Unmet requirements to close",
      context.focus?.length
        ? context.focus
            .map((gap) => `- \`${gap.requirement_id}\`: ${gap.what_is_missing} → ${gap.suggested_action}`)
            .join("\n")
        : undefined,
    ),
    ...section(
      "Evidence index",
      context.evidence?.length ? ResearchEvidence.catalog(context.evidence) : undefined,
      context.evidence && !context.evidence.length && stage !== "plan" && stage !== "collect"
        ? "No evidence was collected. Report this rather than citing anything."
        : undefined,
    ),
    ...section(`Your previous ${stage} result`, context.previous ? fence(context.previous) : undefined),
    ...(context.results ?? []).flatMap((item) => section(`Prior stage: ${item.stage}`, fence(item.result))),
  ].join("\n")
}

function section(heading: string, ...bodies: ReadonlyArray<string | undefined>) {
  const body = bodies.filter((item) => item !== undefined).join("\n")
  return body ? ["", `${heading}:`, "", body] : []
}

function fence(value: unknown) {
  return ["```json", JSON.stringify(value, undefined, 2), "```"].join("\n")
}


export function stageOutputMessageID(run: ResearchRun.Info, stage: ResearchRun.Stage) {
  const item = run.stages.find((entry) => entry.stage === stage)
  return (
    item?.attempts.findLast((attempt) => attempt.status === "succeeded" && attempt.messageID !== undefined)
      ?.messageID ?? item?.messageID
  )
}

/**
 * Splits a plan's requirements across at most `width` subcollectors. Buckets are dealt round-robin
 * rather than sliced, so a plan whose requirements are ordered by subquestion spreads across
 * collectors instead of loading one of them with a single subquestion's whole depth.
 *
 * An empty result means "do not split": one bucket is the sequential path, and running it through a
 * child session would only add a session and a turn to reach the same place.
 */
export function buckets(requirements: ReadonlyArray<ResearchSchema.Requirement>, width: number) {
  const count = Math.min(Math.floor(width), requirements.length)
  if (count < 2) return []
  const out: ResearchSchema.Requirement[][] = Array.from({ length: count }, () => [])
  requirements.forEach((requirement, index) => out[index % count]!.push(requirement))
  return out as ReadonlyArray<ReadonlyArray<ResearchSchema.Requirement>>
}

/**
 * A stage is finished when its submission tool settled. The decoded call is the stage result, so
 * nothing has to be inferred from prose — an absent or malformed call is simply an unfinished stage.
 */
export function stageResult(stage: ResearchRun.Stage, messages: ReadonlyArray<SessionMessage.Assistant>) {
  const submitted = messages.flatMap((message) =>
    message.content.filter(
      (part) =>
        part.type === "tool" &&
        part.name === ResearchStageTool.stageTools[stage] &&
        part.state.status === "completed",
    ),
  )
  const last = submitted.at(-1)
  if (!last || last.type !== "tool" || last.state.status !== "completed") return Effect.succeedNone
  return Schema.decodeUnknownEffect(ResearchSchema.forStage[stage])(last.state.structured).pipe(
    Effect.map((result) => Option.some(result as ResearchSchema.StageResult)),
    Effect.catch(() => Effect.succeedNone),
  )
}

export interface Usage {
  readonly cost: number
  readonly tokens: number
}

export interface Spend {
  readonly total: Usage
  readonly byStage: ReadonlyMap<ResearchRun.Stage, Usage>
}

const NOTHING: Usage = { cost: 0, tokens: 0 }

function tally(messages: ReadonlyArray<SessionMessage.Assistant>): Usage {
  return messages.reduce<Usage>(
    (total, message) => ({
      cost: total.cost + (message.cost ?? 0),
      tokens:
        total.tokens +
        (message.tokens
          ? message.tokens.input +
            message.tokens.output +
            message.tokens.reasoning +
            message.tokens.cache.read +
            message.tokens.cache.write
          : 0),
    }),
    NOTHING,
  )
}

/**
 * What a run has spent, in total and per stage. It is read back from the session's assistant turns
 * rather than kept as a running tally, so a resumed run answers for what its earlier attempt spent
 * instead of starting over at zero, and a session that also holds ordinary chat is bounded by the
 * run's own start time.
 *
 * A stage's intermediate steps precede the message its provider attempt settled on, so a turn
 * belongs to the first stage whose attempt lands at or after it. Trailing turns from a round that
 * never settled count toward the total and belong to no stage.
 */
export function spend(run: ResearchRun.Info, messages: ReadonlyArray<SessionMessage.Assistant>): Spend {
  const from = DateTime.toEpochMillis(run.startedAt)
  const owned = messages.filter((message) => DateTime.toEpochMillis(message.time.created) >= from)
  const owner = new Map<SessionMessage.ID, ResearchRun.Stage>()
  for (const stage of run.stages)
    for (const attempt of stage.attempts)
      if (attempt.messageID !== undefined) owner.set(attempt.messageID, stage.stage)
  const byStage = new Map<ResearchRun.Stage, Usage>()
  let pending: SessionMessage.Assistant[] = []
  for (const message of owned) {
    pending.push(message)
    const stage = owner.get(message.id)
    if (stage === undefined) continue
    const previous = byStage.get(stage) ?? NOTHING
    const round = tally(pending)
    byStage.set(stage, { cost: previous.cost + round.cost, tokens: previous.tokens + round.tokens })
    pending = []
  }
  return { total: tally(owned), byStage }
}

export function render(input: {
  readonly run: ResearchRun.Info
  readonly outputs: ReadonlyArray<StageOutput>
  readonly limits: ResearchBudget.Limits
  readonly usage: Spend
}) {
  const written = input.outputs.find((output) => output.stage === "report")?.result
  const report = written?.stage === "report" ? written.markdown.trim() : undefined
  if (!report) return
  const provenance = input.outputs.map((output) => {
    const stage = input.run.stages.find((item) => item.stage === output.stage)
    const attempts = stage?.attempts.length
      ? stage.attempts.map((attempt) => `  - ${attempt.attempt}: \`${attempt.entry}\``).join("\n")
      : "  - None recorded"
    const tools = output.messages.flatMap((message) => message.content.filter((part) => part.type === "tool"))
    const toolLines = tools.length
      ? tools
          .map((tool) => {
            const input =
              tool.state.status === "pending" ? tool.state.input : JSON.stringify(tool.state.input).slice(0, 2_000)
            return `  - \`${tool.name}\` (${tool.state.status}): \`${input.replaceAll("`", "\\`")}\``
          })
          .join("\n")
      : "  - None"
    const spent = input.usage.byStage.get(output.stage)
    return [
      `### ${output.stage}`,
      "",
      `- Selected model: \`${output.messages.at(-1)?.model.providerID}/${output.messages.at(-1)?.model.id}\``,
      "- Provider attempts:",
      attempts,
      ...(stage?.reopenings.length
        ? ["- Rounds:", ...stage.reopenings.map((item) => `  - ${item.round}: ${item.reason}`)]
        : []),
      ...(spent ? [`- Usage: ${spent.tokens} tokens, cost ${spent.cost}`] : []),
      // Reaching the ceiling withdraws the stage's tools, so the fact is stated rather than left
      // to be inferred from a stage that stopped gathering earlier than its plan called for.
      ...(output.messages.length >= ResearchBudget.steps(input.limits, output.stage)
        ? [
            `- Step ceiling: reached ${ResearchBudget.steps(input.limits, output.stage)}; tools were withdrawn for the final step`,
          ]
        : []),
      "- Tool calls:",
      toolLines,
    ].join("\n")
  })
  // Each row carries the digest of the full retrieved text, so a citation stays checkable after the
  // fact even though only an excerpt is stored. A rechecked row names the row it replaced.
  const evidence = input.run.evidence.map((item) => {
    const superseded = input.run.evidence.find((entry) => entry.id === item.supersedes)
    const recheck = superseded
      ? ` — recheck of \`${superseded.id}\`, ${superseded.digest === item.digest ? "unchanged" : "changed"}`
      : ""
    return `- \`${item.id}\` (${item.stage}, ${item.source.kind}) ${ResearchEvidence.describe(item.source)} — \`${item.digest.slice(0, 12)}\`${recheck}`
  })
  const unmet = input.outputs.flatMap((output) =>
    ResearchSchema.gaps(output.result).map(
      (gap) => `- \`${gap.requirement_id}\` (${output.stage}): ${gap.what_is_missing} → ${gap.suggested_action}`,
    ),
  )
  // A split collection is stated rather than left to be inferred from evidence whose collecting
  // session is not the run's own, and a bucket whose child failed is visible as such.
  const subcollections = input.run.subcollections.map(
    (item) =>
      `  - \`${item.sessionID}\` (round ${item.round}, ${item.outcome ?? item.status}): ${item.requirementIDs.join(", ")}`,
  )
  return [
    report,
    ...(unmet.length ? ["", "## Unmet requirements", "", ...unmet] : []),
    "",
    "## Provenance",
    "",
    `- Research run: \`${input.run.id}\``,
    `- Profile: \`${input.run.profile}\``,
    `- Session: \`${input.run.sessionID}\``,
    ...(subcollections.length ? ["- Subcollections:", ...subcollections] : []),
    `- Usage: ${input.usage.total.tokens} of ${input.limits.maxTokens} tokens, cost ${input.usage.total.cost} of ${input.limits.maxCost}`,
    "",
    ...provenance,
    ...(evidence.length ? ["", "### Evidence", "", ...evidence] : []),
    "",
  ].join("\n")
}


const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service
    const research = yield* ResearchRun.Service
    const locations = yield* LocationServiceMap.Service
    const db = (yield* Database.Service).db
    const locks = KeyedMutex.makeUnsafe<SessionSchema.ID>()

    /** The assistant turns a stage produced, including the intermediate tool-calling steps. */
    const turns = Effect.fn("ResearchWorkflow.turns")(function* (
      sessionID: SessionSchema.ID,
      after: SessionMessage.ID | undefined,
    ) {
      const messages = yield* sessions.messages({
        sessionID,
        order: "asc",
        ...(after ? { cursor: { id: after, direction: "next" as const } } : {}),
      })
      return messages.filter((message) => message.type === "assistant")
    })

    const latest = Effect.fn("ResearchWorkflow.latest")(function* (sessionID: SessionSchema.ID) {
      const messages = yield* sessions.messages({ sessionID, limit: 1, order: "desc" })
      return messages.at(0)?.id
    })

    /**
     * Evidence is harvested from settled tool calls rather than declared by the model, so a stage
     * cannot omit or invent what it consulted. Recording is idempotent per tool call and source.
     */
    const harvest = Effect.fn("ResearchWorkflow.harvest")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly runID: ResearchRun.ID
      readonly stage: ResearchRun.Stage
      readonly messages: ReadonlyArray<SessionMessage.Assistant>
      /** Where the tool actually ran. A subcollector's evidence is filed under its child session. */
      readonly collectedSessionID?: SessionSchema.ID
    }) {
      for (const message of input.messages) {
        const candidates = ResearchEvidence.harvest(message)
        if (candidates.length === 0) continue
        yield* research.recordEvidence({
          sessionID: input.sessionID,
          runID: input.runID,
          stage: input.stage,
          collectedSessionID: input.collectedSessionID ?? input.sessionID,
          messageID: message.id,
          candidates,
        })
      }
    })

    const run = Effect.fn("ResearchWorkflow.run")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly question?: string
      readonly profile?: string
      readonly path?: string
      readonly resume?: boolean
      readonly runID?: ResearchRun.ID
      readonly review?: (plan: Readonly<Record<string, unknown>>) => Effect.Effect<PlanReview>
    }) {
      if (!input.resume && (input.question ?? "").trim().length === 0) return yield* new InvalidQuestionError()
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
            const limits = (yield* ResearchBudget.Service).limits
            // A resumed run keeps its profile, so the route is read from the run rather than
            // reselected: resuming must not silently move a stage onto a different model.
            const started = input.resume
              ? yield* research.resume({
                  sessionID: input.sessionID,
                  ...(input.runID ? { runID: input.runID } : {}),
                })
              : yield* research.start({
                  sessionID: input.sessionID,
                  profile: (yield* routes.get(input.profile)).name,
                  question: (input.question ?? "").trim(),
                })
            const selected = yield* routes.get(started.profile)
            const outputs: StageOutput[] = []
            // Both survive a resume: the recollection budget is spent for the run, not for the
            // attempt, and a stage that already completed is not paid for twice.
            let recollected = started.stages.find((entry) => entry.stage === "collect")?.reopenings.length ?? 0
            const finished = new Set(
              started.stages.filter((entry) => entry.status === "completed").map((entry) => entry.stage),
            )
            const opened = new Set(started.stages.map((entry) => entry.stage))

            /**
             * The session's turns as they stood when this attempt began, read exactly once. A
             * resumed run needs them to answer for what its earlier attempt spent and to reread the
             * results of the stages that already completed; rereading them per stage would make a
             * run's own history the thing it spends its time on.
             */
            const history = yield* turns(input.sessionID, undefined)
            const carried = spend(started, history)
            const live = new Map<ResearchRun.Stage, Usage>()

            /** Adds a round's own turns, which is cheaper and more exact than reattributing them. */
            const charge = (stage: ResearchRun.Stage, messages: ReadonlyArray<SessionMessage.Assistant>) => {
              const round = tally(messages)
              const previous = live.get(stage) ?? NOTHING
              live.set(stage, { cost: previous.cost + round.cost, tokens: previous.tokens + round.tokens })
            }

            /** What the run has spent: what it carried in, plus what this attempt has added. */
            const usage = (): Spend => {
              const byStage = new Map(carried.byStage)
              let total = carried.total
              for (const [stage, amount] of live) {
                const previous = byStage.get(stage) ?? NOTHING
                byStage.set(stage, {
                  cost: previous.cost + amount.cost,
                  tokens: previous.tokens + amount.tokens,
                })
                total = { cost: total.cost + amount.cost, tokens: total.tokens + amount.tokens }
              }
              return { total, byStage }
            }

            /**
             * Checked between stage rounds rather than inside one: a run that stops here keeps its
             * evidence and its completed stages, so raising the ceiling and resuming costs only the
             * round that never ran.
             */
            const afford = Effect.fn("ResearchWorkflow.afford")(function* (stage: ResearchRun.Stage) {
              const total = usage().total
              if (total.cost > limits.maxCost)
                return yield* new BudgetExceededError({
                  stage,
                  limit: "cost",
                  spent: total.cost,
                  allowed: limits.maxCost,
                })
              if (total.tokens > limits.maxTokens)
                return yield* new BudgetExceededError({
                  stage,
                  limit: "tokens",
                  spent: total.tokens,
                  allowed: limits.maxTokens,
                })
            })

            /** A reopened stage replaces its earlier output rather than appending a second one. */
            const record = (output: StageOutput) => {
              const index = outputs.findIndex((entry) => entry.stage === output.stage)
              if (index < 0) outputs.push(output)
              if (index >= 0) outputs[index] = output
            }

            /**
             * A stage is shown only the stages that precede it. After a loop back to collection the
             * downstream results are stale by construction, so this is what keeps them out of the
             * prompt without having to discard them from the report.
             */
            const priorResults = (stage: ResearchRun.Stage) =>
              outputs
                .filter((entry) => order(entry.stage) < order(stage))
                .map((entry) => ({ stage: entry.stage, result: entry.result }))

            /**
             * Collection split across child sessions. Each child is a real session with its own
             * runner and its own permission prompts — spec §6.6 is not relaxed for them — and it
             * borrows the collect stage only for as long as its subcollection is open. Evidence and
             * spend are filed against the parent run, which stays the single source of truth.
             *
             * A child that fails is settled as failed and costs the run its bucket, not the run: the
             * parent still submits coverage, and an unmet requirement is what the gap loop is for.
             */
            const subcollect = Effect.fn("ResearchWorkflow.subcollect")(function* (round: number) {
              const state = (yield* research.current(input.sessionID))!
              if (!state.plan) return []
              const decoded = yield* Schema.decodeUnknownEffect(ResearchSchema.Plan)(state.plan).pipe(
                Effect.map(Option.some),
                Effect.catch(() => Effect.succeedNone),
              )
              if (Option.isNone(decoded)) return []
              const groups = buckets(decoded.value.requirements, limits.maxParallelCollectors)
              if (groups.length === 0) return []
              yield* Effect.logInfo(
                `Research collection split across ${groups.length} sessions for run ${started.id}`,
              )
              const results = yield* Effect.forEach(
                groups,
                (assigned) =>
                  Effect.gen(function* () {
                    const child = yield* sessions.create({
                      location: session.location,
                      parentID: input.sessionID,
                    })
                    yield* research.startSubcollection({
                      sessionID: input.sessionID,
                      runID: started.id,
                      childSessionID: child.id,
                      round,
                      requirementIDs: assigned.map((requirement) => requirement.id),
                    })
                    const outcome = yield* Effect.gen(function* () {
                      yield* sessions.prompt({
                        sessionID: child.id,
                        prompt: Prompt.make({
                          text: prompt("collect", started.question, {
                            ...(state.plan ? { plan: state.plan } : {}),
                            evidence: state.evidence,
                            round,
                            assigned,
                          }),
                        }),
                        resume: false,
                      })
                      yield* sessions.resume(child.id)
                      const produced = yield* turns(child.id, undefined)
                      charge("collect", produced)
                      yield* harvest({
                        sessionID: input.sessionID,
                        runID: started.id,
                        stage: "collect",
                        messages: produced,
                        collectedSessionID: child.id,
                      })
                      return yield* stageResult("collect", produced)
                    }).pipe(Effect.catchCause(() => Effect.succeedNone))
                    yield* research.settleSubcollection({
                      sessionID: input.sessionID,
                      runID: started.id,
                      childSessionID: child.id,
                      outcome: Option.isSome(outcome) ? "succeeded" : "failed",
                    })
                    return Option.getOrUndefined(outcome)
                  }),
                { concurrency: limits.maxParallelCollectors },
              )
              return results.filter((result): result is ResearchSchema.Collect => result?.stage === "collect")
            })

            /** One round of a stage: the provider turn, its evidence, and one correction retry. */
            const runRound = Effect.fn("ResearchWorkflow.runRound")(function* (
              item: (typeof stages)[number],
              current: {
                readonly round: number
                readonly focus?: ReadonlyArray<ResearchSchema.Gap>
                readonly subcollected?: ReadonlyArray<ResearchSchema.Collect>
              },
            ) {
              const previous = outputs.find((entry) => entry.stage === item.stage)?.result
              let output: StageOutput | undefined
              for (const correction of [false, true]) {
                const before = yield* latest(input.sessionID)
                const state = (yield* research.current(input.sessionID))!
                const stated = prompt(item.stage, started.question, {
                  ...(state.plan ? { plan: state.plan } : {}),
                  evidence: state.evidence,
                  results: priorResults(item.stage),
                  round: current.round,
                  ...(current.focus?.length ? { focus: current.focus } : {}),
                  ...(previous ? { previous } : {}),
                  ...(current.subcollected?.length ? { subcollected: current.subcollected } : {}),
                })
                yield* sessions.prompt({
                  sessionID: input.sessionID,
                  prompt: Prompt.make({
                    text: correction
                      ? `${stated}\n\nThe previous turn ended without a settled \`${ResearchStageTool.stageTools[item.stage]}\` call, so the stage is unfinished. Call it now.`
                      : stated,
                  }),
                  resume: false,
                  researchRunID: started.id,
                })
                yield* sessions.resume(input.sessionID)
                const produced = yield* turns(input.sessionID, before)
                charge(item.stage, produced)
                // Harvest before reading the result so a stage's own recon shows up as evidence.
                yield* harvest({
                  sessionID: input.sessionID,
                  runID: started.id,
                  stage: item.stage,
                  messages: produced,
                })
                const failure = produced.findLast((message) => message.finish === "error")
                if (failure && produced.length === 1)
                  return yield* new StageFailedError({
                    stage: item.stage,
                    message: failure.error?.message ?? "Provider turn failed.",
                  })
                const result = yield* stageResult(item.stage, produced)
                if (Option.isSome(result)) {
                  output = { stage: item.stage, result: result.value, messages: produced }
                  break
                }
              }
              if (!output)
                return yield* new StageFailedError({
                  stage: item.stage,
                  message: `Provider never settled a \`${ResearchStageTool.stageTools[item.stage]}\` call, so the stage produced no result.`,
                })
              return output
            })

            /** Closes a stage on the submission its round produced. */
            const settle = Effect.fn("ResearchWorkflow.settle")(function* (output: StageOutput) {
              const submission = output.messages.findLast((message) =>
                message.content.some(
                  (part) => part.type === "tool" && part.name === ResearchStageTool.stageTools[output.stage],
                ),
              )!
              if (output.result.stage === "plan")
                yield* research.recordPlan({
                  sessionID: input.sessionID,
                  runID: started.id,
                  messageID: submission.id,
                  plan: output.result as unknown as Readonly<Record<string, unknown>>,
                })
              record(output)
              yield* research.completeStage({
                sessionID: input.sessionID,
                runID: started.id,
                stage: output.stage,
                messageID: submission.id,
              })
            })

            /**
             * A reopened round that never settles must not cost the run the result it already had.
             * The stage is closed again on whatever turn the failed round did produce and the
             * earlier round's output stands, so the gap it went back for simply stays reported. A
             * round that produced no successful turn at all is a real provider failure and rethrows.
             */
            const salvage = Effect.fn("ResearchWorkflow.salvage")(function* (
              stage: ResearchRun.Stage,
              error: StageFailedError,
            ) {
              const state = (yield* research.current(input.sessionID))!
              const info = state.stages.find((entry) => entry.stage === stage)
              const recovered = info
                ? ResearchRun.currentRoundAttempts(info).findLast(
                    (attempt) => attempt.status === "succeeded" && attempt.messageID !== undefined,
                  )?.messageID
                : undefined
              if (!recovered) return yield* error
              yield* research.completeStage({
                sessionID: input.sessionID,
                runID: started.id,
                stage,
                messageID: recovered,
              })
            })

            const reopen = Effect.fn("ResearchWorkflow.reopen")(function* (
              item: (typeof stages)[number],
              detail: { readonly reason: string; readonly focus: ReadonlyArray<ResearchSchema.Gap> },
            ) {
              const round = yield* research.reopenStage({
                sessionID: input.sessionID,
                runID: started.id,
                stage: item.stage,
                reason: detail.reason,
              })
              return yield* runRound(item, { round, focus: detail.focus }).pipe(
                Effect.map(Option.some),
                Effect.catchTag("ResearchWorkflow.StageFailedError", (error) =>
                  salvage(item.stage, error).pipe(Effect.as(Option.none<StageOutput>())),
                ),
              )
            })

            /**
             * The bounded loop back to collection. A reported gap is either a source nobody looked
             * for or one that does not exist, and only another collection round tells them apart.
             * Just the reporting stage is rerun with it: verify already rules against the whole
             * evidence index, so re-running analyze in between would double the cost of the round
             * without widening what verify can see.
             */
            const closeGaps = Effect.fn("ResearchWorkflow.closeGaps")(function* (item: (typeof stages)[number]) {
              const focus = ResearchSchema.gaps(outputs.find((entry) => entry.stage === item.stage)!.result)
              if (focus.length === 0 || recollected >= limits.maxRecollectRounds) return
              recollected = recollected + 1
              const reason = `${item.stage} reported ${focus.length} unmet requirement${focus.length === 1 ? "" : "s"}`
              for (const stage of [stages[1], item]) {
                yield* afford(stage.stage)
                const redone = yield* reopen(stage, { reason, focus })
                if (Option.isNone(redone)) return
                yield* settle(redone.value)
              }
            })

            /**
             * The result a completed stage already submitted, read back from the turn it closed on.
             * A resumed run needs it to render the report and to give the stages it still has to run
             * the context their predecessors produced.
             */
            const recover = Effect.fn("ResearchWorkflow.recover")(function* (stage: ResearchRun.Stage) {
              const state = (yield* research.current(input.sessionID))!
              const messageID = stageOutputMessageID(state, stage)
              const messages = messageID ? history.filter((message) => message.id === messageID) : []
              const result = yield* stageResult(stage, messages)
              if (Option.isNone(result))
                return yield* new StageFailedError({
                  stage,
                  message: `Stage ${stage} completed earlier but its submission can no longer be read, so the run cannot be resumed.`,
                })
              record({ stage, result: result.value, messages })
            })

            /**
             * The opt-in gate between plan and collect. It runs after the plan is durable, so a
             * declined plan leaves a resumable run rather than discarding the planning it paid for.
             */
            const reviewPlan = Effect.fn("ResearchWorkflow.reviewPlan")(function* () {
              if (!input.review) return
              const state = (yield* research.current(input.sessionID))!
              if (!state.plan) return
              const verdict = yield* input.review(state.plan)
              if (!verdict.approved) return yield* new PlanRejectedError({ reason: verdict.reason })
              if (!verdict.plan) return
              yield* research.recordPlan({
                sessionID: input.sessionID,
                runID: started.id,
                messageID: stageOutputMessageID(state, "plan")!,
                plan: verdict.plan,
              })
            })

            const workflow = Effect.gen(function* () {
              for (const item of stages) {
                if (finished.has(item.stage)) {
                  yield* recover(item.stage)
                  continue
                }
                yield* afford(item.stage)
                const route = selected.profile[item.role]
                yield* routes.route({ profile: selected.name, role: item.role })
                // A resumed run picks a stage back up where it stopped; only a stage that never
                // started is started.
                if (!opened.has(item.stage))
                  yield* research.startStage({
                    sessionID: input.sessionID,
                    runID: started.id,
                    stage: item.stage,
                    role: item.role,
                    route,
                  })
                const state = (yield* research.current(input.sessionID))!
                const round = (state.stages.find((entry) => entry.stage === item.stage)?.reopenings.length ?? 0) + 1
                // Only the first collection round fans out. A reopened round exists to close named
                // gaps, which is narrow work that splitting would cost more to coordinate than run.
                const subcollected =
                  item.stage === "collect" && round === 1 && state.subcollections.length === 0
                    ? yield* subcollect(round)
                    : []
                yield* settle(yield* runRound(item, { round, subcollected }))
                if (item.stage === "plan") yield* reviewPlan()
                if (item.stage === "analyze" || item.stage === "verify") yield* closeGaps(item)
              }
              const current = (yield* research.current(input.sessionID))!
              const report = render({ run: current, outputs, limits, usage: usage() })
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
