export * as ResearchRun from "./research-run"

import { Event } from "@opencode-ai/schema/event"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { eq } from "drizzle-orm"
import { ConfigResearch } from "./config/research"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { KeyedMutex } from "./effect/keyed-mutex"
import { EventV2 } from "./event"
import { ResearchEvidence } from "./research-evidence"
import { SessionMessage } from "./session/message"
import { SessionTable } from "./session/sql"
import { SessionSchema } from "./session/schema"

export const ID = Schema.String.check(Schema.isPattern(/^run_[A-Za-z0-9]+$/)).pipe(Schema.brand("ResearchRun.ID"))
export type ID = typeof ID.Type

export const TurnID = Schema.String.check(Schema.isPattern(/^turn_[A-Za-z0-9]+$/)).pipe(
  Schema.brand("ResearchRun.TurnID"),
)
export type TurnID = typeof TurnID.Type

export type Stage = SessionEvent.Research.Stage
export type Role = SessionEvent.Research.Role
export type AttemptOutcome = SessionEvent.Research.ProviderAttemptSettled["data"]["outcome"]

const stages = [
  { stage: "plan", role: "planner" },
  { stage: "collect", role: "collector" },
  { stage: "analyze", role: "analyst" },
  { stage: "verify", role: "verifier" },
  { stage: "report", role: "writer" },
] as const

export interface Attempt {
  readonly turnID: TurnID
  readonly entry: string
  readonly attempt: number
  readonly status: "active" | AttemptOutcome
  readonly replaySafe?: boolean
  readonly messageID?: SessionMessage.ID
}

export interface Reopening {
  readonly round: number
  readonly reason: string
  /** Index into `attempts` where this round's attempts begin; earlier rounds stay in the list. */
  readonly fromAttempt: number
}

export interface StageInfo {
  readonly stage: Stage
  readonly role: Role
  readonly route: ReadonlyArray<string>
  readonly attempts: ReadonlyArray<Attempt>
  readonly status: "active" | "completed"
  /** One entry per reopening, in order. The current round is `reopenings.length + 1`. */
  readonly reopenings: ReadonlyArray<Reopening>
  readonly messageID?: SessionMessage.ID
}

export interface Subcollection {
  /** The child session doing the gathering. Its `parentID` is the run's session. */
  readonly sessionID: SessionSchema.ID
  readonly round: number
  readonly requirementIDs: ReadonlyArray<string>
  readonly status: "active" | "settled"
  readonly outcome?: "succeeded" | "failed"
}

export interface Info {
  readonly id: ID
  readonly sessionID: SessionSchema.ID
  readonly profile: ConfigResearch.ProfileName
  readonly question: string
  readonly status: "active" | "completed" | "failed"
  /** When the run began. Bounds which of a shared session's turns the run has to answer for. */
  readonly startedAt: DateTime.Utc
  readonly stages: ReadonlyArray<StageInfo>
  /** Harvested from tool calls, so it survives compaction and outlives the message history. */
  readonly evidence: ReadonlyArray<ResearchEvidence.Evidence>
  /** Child sessions collection was split across. Empty unless `max_parallel_collectors` exceeds 1. */
  readonly subcollections: ReadonlyArray<Subcollection>
  readonly stage?: StageInfo
  readonly plan?: Readonly<Record<string, unknown>>
  readonly reportPath?: string
  readonly error?: string
}

/**
 * The stage a child session may borrow, which is the collect stage and only while the run names
 * that child in an open subcollection. This is the whole of a child's authority: a session that
 * points its `parentID` at a research run gets nothing from doing so.
 */
export function subcollectionStage(run: Info, childSessionID: SessionSchema.ID) {
  if (run.status !== "active") return undefined
  const open = run.subcollections.find((item) => item.sessionID === childSessionID && item.status === "active")
  if (!open) return undefined
  const stage = run.stages.find((item) => item.stage === "collect")
  if (!stage || stage.status !== "active") return undefined
  // The child records no attempts of its own, so it is handed the stage without the parent's.
  return { ...stage, attempts: [] satisfies ReadonlyArray<Attempt> }
}

/** A child session's borrowed authority: whose run, which stage, and for which requirements. */
export interface Borrowed {
  readonly run: Info
  readonly stage: StageInfo
  readonly requirementIDs: ReadonlyArray<string>
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("ResearchRun.NotFoundError", {
  sessionID: SessionSchema.ID,
}) {
  override get message() {
    return `No research run exists for session ${this.sessionID}`
  }
}

export class RunMismatchError extends Schema.TaggedErrorClass<RunMismatchError>()("ResearchRun.RunMismatchError", {
  sessionID: SessionSchema.ID,
  expected: ID,
  actual: ID,
}) {
  override get message() {
    return `Research run mismatch for session ${this.sessionID}: expected ${this.expected}, got ${this.actual}`
  }
}

export class InvalidTransitionError extends Schema.TaggedErrorClass<InvalidTransitionError>()(
  "ResearchRun.InvalidTransitionError",
  {
    sessionID: SessionSchema.ID,
    message: Schema.String,
  },
) {}

export class InvalidHistoryError extends Schema.TaggedErrorClass<InvalidHistoryError>()(
  "ResearchRun.InvalidHistoryError",
  {
    sessionID: SessionSchema.ID,
    message: Schema.String,
  },
) {}

export class IndeterminateAttemptError extends Schema.TaggedErrorClass<IndeterminateAttemptError>()(
  "ResearchRun.IndeterminateAttemptError",
  {
    sessionID: SessionSchema.ID,
    runID: ID,
    stage: SessionEvent.Research.Stage,
    turnID: TurnID,
    entry: Schema.String,
  },
) {
  override get message() {
    return `Research provider attempt ${this.turnID} for ${this.entry} has no durable outcome; automatic replay is blocked`
  }
}

export class ResumeUnavailableError extends Schema.TaggedErrorClass<ResumeUnavailableError>()(
  "ResearchRun.ResumeUnavailableError",
  {
    sessionID: SessionSchema.ID,
    runID: ID.pipe(Schema.optional),
    status: Schema.String.pipe(Schema.optional),
  },
) {
  override get message() {
    return this.runID === undefined
      ? `Session ${this.sessionID} has no research run to resume`
      : `Research run ${this.runID} is ${this.status} and only a failed run can be resumed`
  }
}

export type MutationError = NotFoundError | RunMismatchError | InvalidTransitionError | IndeterminateAttemptError

export interface Interface {
  readonly current: (sessionID: SessionSchema.ID) => Effect.Effect<Info | undefined, InvalidHistoryError>
  /**
   * What a session may do on another session's behalf. A subcollector has no run of its own: it
   * borrows the collect stage of the run on its parent, and only for the bucket that run opened for
   * it. Nothing here is derived from the child's own stream, so a session cannot grant itself
   * anything by pointing its `parentID` at a research run.
   */
  readonly borrowed: (sessionID: SessionSchema.ID) => Effect.Effect<Borrowed | undefined, InvalidHistoryError>
  readonly start: (input: {
    readonly sessionID: SessionSchema.ID
    readonly profile: ConfigResearch.ProfileName
    readonly question: string
  }) => Effect.Effect<Info, InvalidHistoryError | InvalidTransitionError>
  readonly startStage: (input: {
    readonly sessionID: SessionSchema.ID
    readonly runID: ID
    readonly stage: Stage
    readonly role: Role
    readonly route: ReadonlyArray<string>
  }) => Effect.Effect<void, MutationError | InvalidHistoryError>
  readonly startAttempt: (input: {
    readonly sessionID: SessionSchema.ID
    readonly runID: ID
    readonly stage: Stage
    readonly role: Role
    readonly turnID: TurnID
    readonly entry: string
    readonly attempt: number
  }) => Effect.Effect<void, MutationError | InvalidHistoryError>
  readonly settleAttempt: (input: {
    readonly sessionID: SessionSchema.ID
    readonly runID: ID
    readonly stage: Stage
    readonly role: Role
    readonly turnID: TurnID
    readonly entry: string
    readonly attempt: number
    readonly outcome: AttemptOutcome
    readonly replaySafe: boolean
    readonly messageID?: SessionMessage.ID
  }) => Effect.Effect<void, MutationError | InvalidHistoryError>
  readonly completeStage: (input: {
    readonly sessionID: SessionSchema.ID
    readonly runID: ID
    readonly stage: Stage
    readonly messageID: SessionMessage.ID
  }) => Effect.Effect<void, MutationError | InvalidHistoryError>
  /** Reactivates a completed stage for another round. The reason travels into the report. */
  readonly reopenStage: (input: {
    readonly sessionID: SessionSchema.ID
    readonly runID: ID
    readonly stage: Stage
    readonly reason: string
  }) => Effect.Effect<number, MutationError | InvalidHistoryError>
  /** Records what a settled turn actually retrieved. Candidates already stored are skipped. */
  readonly recordEvidence: (input: {
    readonly sessionID: SessionSchema.ID
    readonly runID: ID
    readonly stage: Stage
    readonly collectedSessionID: SessionSchema.ID
    readonly messageID: SessionMessage.ID
    readonly candidates: ReadonlyArray<ResearchEvidence.Candidate>
    /** Set when the candidates re-retrieve an already-recorded source. */
    readonly supersedes?: string
  }) => Effect.Effect<ReadonlyArray<ResearchEvidence.Evidence>, MutationError | InvalidHistoryError>
  readonly recordPlan: (input: {
    readonly sessionID: SessionSchema.ID
    readonly runID: ID
    readonly messageID: SessionMessage.ID
    readonly plan: Readonly<Record<string, unknown>>
  }) => Effect.Effect<void, MutationError | InvalidHistoryError>
  /**
   * Opens a child session's borrowed authority to collect for this run. Only while one of these is
   * open does `subcollectionStage` hand that child the collect stage.
   */
  readonly startSubcollection: (input: {
    readonly sessionID: SessionSchema.ID
    readonly runID: ID
    readonly childSessionID: SessionSchema.ID
    readonly round: number
    readonly requirementIDs: ReadonlyArray<string>
  }) => Effect.Effect<void, MutationError | InvalidHistoryError>
  readonly settleSubcollection: (input: {
    readonly sessionID: SessionSchema.ID
    readonly runID: ID
    readonly childSessionID: SessionSchema.ID
    readonly outcome: "succeeded" | "failed"
  }) => Effect.Effect<void, MutationError | InvalidHistoryError>
  readonly complete: (input: {
    readonly sessionID: SessionSchema.ID
    readonly runID: ID
    readonly reportPath?: string
  }) => Effect.Effect<void, MutationError | InvalidHistoryError>
  readonly fail: (input: {
    readonly sessionID: SessionSchema.ID
    readonly runID: ID
    readonly message: string
  }) => Effect.Effect<void, MutationError | InvalidHistoryError>
  /**
   * Reactivates a failed run at the first stage that never completed. Everything the run already
   * established stands, so resuming costs only the work that was actually lost.
   */
  readonly resume: (input: {
    readonly sessionID: SessionSchema.ID
    readonly runID?: ID
  }) => Effect.Effect<Info, MutationError | InvalidHistoryError | ResumeUnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ResearchRun") {}

const manifest = {
  definitions: Event.durable(SessionEvent.Research.DurableDefinitions),
  schema: SessionEvent.Research.Durable,
}

const createID = () => ID.make(`run_${crypto.randomUUID().replaceAll("-", "")}`)
export const createTurnID = () => TurnID.make(`turn_${crypto.randomUUID().replaceAll("-", "")}`)

export function fold(events: ReadonlyArray<SessionEvent.Research.DurableEvent>): Info | undefined {
  let state: Info | undefined
  for (const event of events) {
    if (event.type === SessionEvent.Research.Started.type) {
      if (state?.status === "active")
        invalid(event.data.sessionID, "Cannot start a new run while another run is active")
      state = {
        id: ID.make(event.data.runID),
        sessionID: event.data.sessionID,
        profile: ConfigResearch.ProfileName.make(event.data.profile),
        question: event.data.question,
        status: "active",
        startedAt: event.data.timestamp,
        stages: [],
        evidence: [],
        subcollections: [],
      }
      continue
    }
    if (!state) invalid(event.data.sessionID, `Research event ${event.type} occurred before a run started`)
    if (state.id !== event.data.runID)
      invalid(event.data.sessionID, `Research event ${event.type} targets inactive run ${event.data.runID}`)
    if (event.type === SessionEvent.Research.StageStarted.type) {
      requireActive(state, event.type)
      if (state.stage?.status === "active")
        invalid(state.sessionID, "Cannot start a stage while another stage is active")
      if (state.stages.some((stage) => stage.stage === event.data.stage))
        invalid(state.sessionID, `Research stage ${event.data.stage} was started more than once`)
      const expected = stages[state.stages.length]
      if (!expected || expected.stage !== event.data.stage || expected.role !== event.data.role)
        invalid(
          state.sessionID,
          `Expected research stage ${expected?.stage ?? "none"}/${expected?.role ?? "none"}, got ${event.data.stage}/${event.data.role}`,
        )
      const stage: StageInfo = {
        stage: event.data.stage,
        role: event.data.role,
        route: event.data.route,
        attempts: [],
        status: "active",
        reopenings: [],
      }
      state = { ...state, stage, stages: [...state.stages, stage] }
      continue
    }
    if (event.type === SessionEvent.Research.ProviderAttempted.type) {
      const stage = requireStage(state, event.data.stage, event.data.role, event.type)
      if (stage.attempts.some((attempt) => attempt.status === "active"))
        invalid(state.sessionID, "Cannot start a provider attempt while another attempt is unsettled")
      const previous = stage.attempts.at(-1)
      const valid =
        event.data.attempt === 1
          ? previous?.turnID !== event.data.turnID
          : previous?.turnID === event.data.turnID &&
            previous.attempt + 1 === event.data.attempt &&
            previous.status === "retryable-failure" &&
            previous.replaySafe === true
      if (!valid) {
        invalid(state.sessionID, `Provider attempt ${event.data.attempt} is not an eligible fallback`)
      }
      const next = {
        ...stage,
        attempts: [
          ...stage.attempts,
          {
            turnID: TurnID.make(event.data.turnID),
            entry: event.data.entry,
            attempt: event.data.attempt,
            status: "active" as const,
          },
        ],
      }
      state = replaceStage(state, next)
      continue
    }
    if (event.type === SessionEvent.Research.ProviderAttemptSettled.type) {
      const stage = requireStage(state, event.data.stage, event.data.role, event.type)
      const active = stage.attempts.at(-1)
      if (
        !active ||
        active.status !== "active" ||
        active.turnID !== event.data.turnID ||
        active.entry !== event.data.entry ||
        active.attempt !== event.data.attempt
      )
        invalid(state.sessionID, `Provider settlement does not match the active attempt ${event.data.turnID}`)
      if (event.data.outcome === "retryable-failure" && !event.data.replaySafe)
        invalid(state.sessionID, "Retryable provider settlement must be explicitly replay-safe")
      if (event.data.outcome === "succeeded" && event.data.messageID === undefined)
        invalid(state.sessionID, "Successful provider settlement must identify its assistant message")
      if (event.data.outcome !== "succeeded" && event.data.messageID !== undefined)
        invalid(state.sessionID, "Failed provider settlement must not identify a successful assistant message")
      const settled = {
        ...active,
        status: event.data.outcome,
        replaySafe: event.data.replaySafe,
        messageID: event.data.messageID,
      }
      const next = { ...stage, attempts: [...stage.attempts.slice(0, -1), settled] }
      state = replaceStage(state, next)
      continue
    }
    if (event.type === SessionEvent.Research.StageCompleted.type) {
      const stage = requireStage(state, event.data.stage, undefined, event.type)
      if (stage.attempts.some((attempt) => attempt.status === "active"))
        invalid(state.sessionID, "Cannot complete a stage with an unsettled provider attempt")
      if (
        !currentRoundAttempts(stage).some(
          (attempt) => attempt.status === "succeeded" && attempt.messageID === event.data.messageID,
        )
      )
        invalid(state.sessionID, "Stage completion does not match a successful provider attempt")
      const completed = { ...stage, status: "completed" as const, messageID: event.data.messageID }
      state = replaceStage(state, completed)
      continue
    }
    if (event.type === SessionEvent.Research.EvidenceRecorded.type) {
      requireActive(state, event.type)
      if (!state.stages.some((stage) => stage.stage === event.data.stage))
        invalid(state.sessionID, `Research evidence references stage ${event.data.stage}, which never started`)
      if (state.evidence.some((item) => item.id === event.data.evidenceID))
        invalid(state.sessionID, `Research evidence ${event.data.evidenceID} was recorded more than once`)
      if (event.data.supersedes !== undefined && !state.evidence.some((item) => item.id === event.data.supersedes))
        invalid(state.sessionID, `Research evidence ${event.data.evidenceID} supersedes unknown evidence`)
      state = { ...state, evidence: [...state.evidence, ResearchEvidence.fromEvent(event.data)] }
      continue
    }
    if (event.type === SessionEvent.Research.PlanRecorded.type) {
      requireActive(state, event.type)
      if (!state.stages.some((stage) => stage.stage === "plan"))
        invalid(state.sessionID, "Research plan was recorded before the plan stage started")
      // Last write wins so an approved or edited plan can supersede the generated one.
      state = { ...state, plan: event.data.plan }
      continue
    }
    if (event.type === SessionEvent.Research.StageReopened.type) {
      requireActive(state, event.type)
      if (state.stage?.status === "active")
        invalid(state.sessionID, `Cannot reopen ${event.data.stage} while stage ${state.stage.stage} is active`)
      const existing = state.stages.find((item) => item.stage === event.data.stage)
      if (!existing || existing.status !== "completed")
        invalid(state.sessionID, `Research stage ${event.data.stage} is not completed and cannot be reopened`)
      if (event.data.round !== existing.reopenings.length + 2)
        invalid(
          state.sessionID,
          `Research stage ${event.data.stage} reopened as round ${event.data.round}, expected ${existing.reopenings.length + 2}`,
        )
      const reopened: StageInfo = {
        ...existing,
        status: "active",
        messageID: undefined,
        reopenings: [
          ...existing.reopenings,
          { round: event.data.round, reason: event.data.reason, fromAttempt: existing.attempts.length },
        ],
      }
      state = replaceStage(state, reopened)
      continue
    }
    if (event.type === SessionEvent.Research.SubcollectionStarted.type) {
      requireActive(state, event.type)
      const stage = state.stages.find((item) => item.stage === "collect")
      if (!stage || stage.status !== "active")
        invalid(state.sessionID, "A subcollection can only start while the collect stage is active")
      if (state.subcollections.some((item) => item.sessionID === event.data.childSessionID))
        invalid(state.sessionID, `Subcollection session ${event.data.childSessionID} was started more than once`)
      state = {
        ...state,
        subcollections: [
          ...state.subcollections,
          {
            sessionID: SessionSchema.ID.make(event.data.childSessionID),
            round: event.data.round,
            requirementIDs: event.data.requirementIDs,
            status: "active",
          },
        ],
      }
      continue
    }
    if (event.type === SessionEvent.Research.SubcollectionSettled.type) {
      requireActive(state, event.type)
      const open = state.subcollections.find(
        (item) => item.sessionID === event.data.childSessionID && item.status === "active",
      )
      if (!open) invalid(state.sessionID, `Subcollection session ${event.data.childSessionID} is not open`)
      state = {
        ...state,
        subcollections: state.subcollections.map((item) =>
          item === open ? { ...item, status: "settled" as const, outcome: event.data.outcome } : item,
        ),
      }
      continue
    }
    if (event.type === SessionEvent.Research.Completed.type) {
      requireActive(state, event.type)
      if (state.stage?.stage !== "report" || state.stage.status !== "completed")
        invalid(state.sessionID, "Research can only complete after the report stage")
      state = { ...state, status: "completed", reportPath: event.data.reportPath }
      continue
    }
    if (event.type === SessionEvent.Research.Failed.type) {
      requireActive(state, event.type)
      state = { ...state, status: "failed", error: event.data.message }
      continue
    }
    if (event.type === SessionEvent.Research.Resumed.type) {
      // Only a failed run resumes. Nothing else is touched: the completed stages keep the messages
      // they closed on, the plan stands, and the evidence index carries over intact.
      if (state.status !== "failed")
        invalid(state.sessionID, `Research run ${state.id} is ${state.status} and cannot be resumed`)
      state = { ...state, status: "active", error: undefined }
    }
  }
  return state
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const { db } = yield* Database.Service
    const locks = KeyedMutex.makeUnsafe<SessionSchema.ID>()

    const snapshot = Effect.fn("ResearchRun.snapshot")(function* (sessionID: SessionSchema.ID) {
      const stored = yield* db
        .transaction(
          () =>
            Effect.gen(function* () {
              return {
                recorded: yield* readAll(db, sessionID),
                sequence: yield* EventV2.latestSequence(db, sessionID),
              }
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie)
      const run = yield* Effect.try({
        try: () => fold(stored.recorded),
        catch: (error) =>
          error instanceof InvalidHistoryError
            ? error
            : new InvalidHistoryError({
                sessionID,
                message: error instanceof Error ? error.message : String(error),
              }),
      })
      return { run, sequence: stored.sequence }
    })

    const current = Effect.fn("ResearchRun.current")((sessionID: SessionSchema.ID) =>
      snapshot(sessionID).pipe(Effect.map((state) => state.run)),
    )

    /**
     * The parent link comes from the session row and the grant from the parent's own event stream,
     * so a child cannot widen what it was given by anything it does in its own session.
     */
    const borrowed = Effect.fn("ResearchRun.borrowed")(function* (sessionID: SessionSchema.ID) {
      const rows = yield* db
        .select({ parentID: SessionTable.parent_id })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .pipe(Effect.orDie)
      const parentID = rows.at(0)?.parentID
      if (!parentID) return undefined
      const run = yield* current(parentID)
      if (!run) return undefined
      const stage = subcollectionStage(run, sessionID)
      if (!stage) return undefined
      const open = run.subcollections.find((item) => item.sessionID === sessionID && item.status === "active")!
      return { run, stage, requirementIDs: open.requirementIDs } satisfies Borrowed
    })

    const publish = <D extends EventV2.Definition>(
      definition: D,
      data: EventV2.Data<D>,
      sessionID: SessionSchema.ID,
      expectedSequence: number,
    ) =>
      events
        .publish(definition, data, { expectedSequence })
        .pipe(
          Effect.catchDefect((defect) =>
            defect instanceof EventV2.ConcurrentAggregateWriteError
              ? Effect.fail(transition(sessionID, defect.message))
              : Effect.die(defect),
          ),
        )

    const requireRun = Effect.fn("ResearchRun.require")(function* (sessionID: SessionSchema.ID, runID: ID) {
      const state = yield* snapshot(sessionID)
      const run = state.run
      if (!run) return yield* new NotFoundError({ sessionID })
      if (run.id !== runID)
        return yield* new RunMismatchError({
          sessionID,
          expected: run.id,
          actual: runID,
        })
      if (run.status !== "active") return yield* transition(sessionID, `Research run ${runID} is already ${run.status}`)
      return { run, sequence: state.sequence }
    })

    const requireStageFor = Effect.fn("ResearchRun.requireStage")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly runID: ID
      readonly stage: Stage
      readonly role?: Role
    }) {
      const { run, sequence } = yield* requireRun(input.sessionID, input.runID)
      if (run.stage?.status !== "active" || run.stage.stage !== input.stage)
        return yield* transition(input.sessionID, `Research stage ${input.stage} is not active`)
      if (input.role !== undefined && run.stage.role !== input.role)
        return yield* transition(
          input.sessionID,
          `Research stage ${input.stage} belongs to ${run.stage.role}, not ${input.role}`,
        )
      return { run, stage: run.stage, sequence }
    })

    return Service.of({
      current,
      borrowed,
      start: Effect.fn("ResearchRun.start")((input) =>
        locks.withLock(input.sessionID)(
          Effect.gen(function* () {
            const state = yield* snapshot(input.sessionID)
            if (state.run?.status === "active")
              return yield* transition(input.sessionID, `Research run ${state.run.id} is already active`)
            const runID = createID()
            yield* publish(
              SessionEvent.Research.Started,
              {
                ...input,
                runID,
                timestamp: yield* DateTime.now,
              },
              input.sessionID,
              state.sequence,
            )
            return (yield* current(input.sessionID))!
          }),
        ),
      ),
      startStage: Effect.fn("ResearchRun.startStage")((input) =>
        locks.withLock(input.sessionID)(
          Effect.gen(function* () {
            const { run, sequence } = yield* requireRun(input.sessionID, input.runID)
            if (run.stage?.status === "active")
              return yield* transition(input.sessionID, `Research stage ${run.stage.stage} is already active`)
            if (run.stages.some((stage) => stage.stage === input.stage))
              return yield* transition(input.sessionID, `Research stage ${input.stage} already exists`)
            const expected = stages[run.stages.length]
            if (!expected || expected.stage !== input.stage || expected.role !== input.role)
              return yield* transition(
                input.sessionID,
                `Expected research stage ${expected?.stage ?? "none"}/${expected?.role ?? "none"}, got ${input.stage}/${input.role}`,
              )
            yield* publish(
              SessionEvent.Research.StageStarted,
              {
                ...input,
                route: [...input.route],
                timestamp: yield* DateTime.now,
              },
              input.sessionID,
              sequence,
            )
          }),
        ),
      ),
      startAttempt: Effect.fn("ResearchRun.startAttempt")((input) =>
        locks.withLock(input.sessionID)(
          Effect.gen(function* () {
            const { stage, sequence } = yield* requireStageFor(input)
            const active = stage.attempts.find((attempt) => attempt.status === "active")
            if (active)
              return yield* new IndeterminateAttemptError({
                sessionID: input.sessionID,
                runID: input.runID,
                stage: input.stage,
                turnID: active.turnID,
                entry: active.entry,
              })
            const previous = stage.attempts.at(-1)
            const valid =
              input.attempt === 1
                ? previous?.turnID !== input.turnID
                : previous?.turnID === input.turnID &&
                  previous.attempt + 1 === input.attempt &&
                  previous.status === "retryable-failure" &&
                  previous.replaySafe === true
            if (!valid)
              return yield* transition(
                input.sessionID,
                `Provider attempt ${input.attempt} is not an eligible next attempt for turn ${input.turnID}`,
              )
            yield* publish(
              SessionEvent.Research.ProviderAttempted,
              {
                ...input,
                timestamp: yield* DateTime.now,
              },
              input.sessionID,
              sequence,
            )
          }),
        ),
      ),
      settleAttempt: Effect.fn("ResearchRun.settleAttempt")((input) =>
        locks.withLock(input.sessionID)(
          Effect.gen(function* () {
            const { stage, sequence } = yield* requireStageFor(input)
            const active = stage.attempts.at(-1)
            if (
              !active ||
              active.status !== "active" ||
              active.turnID !== input.turnID ||
              active.entry !== input.entry ||
              active.attempt !== input.attempt
            )
              return yield* transition(
                input.sessionID,
                `Provider settlement does not match active turn ${input.turnID}`,
              )
            if (input.outcome === "retryable-failure" && !input.replaySafe)
              return yield* transition(input.sessionID, "Retryable provider failure is not replay-safe")
            if (input.outcome === "succeeded" && input.messageID === undefined)
              return yield* transition(input.sessionID, "Successful provider settlement requires a message ID")
            if (input.outcome !== "succeeded" && input.messageID !== undefined)
              return yield* transition(input.sessionID, "Failed provider settlement cannot include a message ID")
            yield* publish(
              SessionEvent.Research.ProviderAttemptSettled,
              {
                ...input,
                timestamp: yield* DateTime.now,
              },
              input.sessionID,
              sequence,
            )
          }),
        ),
      ),
      completeStage: Effect.fn("ResearchRun.completeStage")((input) =>
        locks.withLock(input.sessionID)(
          Effect.gen(function* () {
            const { stage, sequence } = yield* requireStageFor(input)
            if (stage.attempts.some((attempt) => attempt.status === "active"))
              return yield* transition(input.sessionID, "Cannot complete a stage with an unsettled provider attempt")
            if (
              !currentRoundAttempts(stage).some(
                (attempt) => attempt.status === "succeeded" && attempt.messageID === input.messageID,
              )
            )
              return yield* transition(input.sessionID, "Stage completion must identify a successful provider attempt")
            yield* publish(
              SessionEvent.Research.StageCompleted,
              {
                ...input,
                timestamp: yield* DateTime.now,
              },
              input.sessionID,
              sequence,
            )
          }),
        ),
      ),
      reopenStage: Effect.fn("ResearchRun.reopenStage")((input) =>
        locks.withLock(input.sessionID)(
          Effect.gen(function* () {
            const { run, sequence } = yield* requireRun(input.sessionID, input.runID)
            if (run.stage?.status === "active")
              return yield* transition(
                input.sessionID,
                `Cannot reopen ${input.stage} while stage ${run.stage.stage} is active`,
              )
            const existing = run.stages.find((item) => item.stage === input.stage)
            if (!existing || existing.status !== "completed")
              return yield* transition(input.sessionID, `Research stage ${input.stage} is not completed`)
            const round = existing.reopenings.length + 2
            yield* publish(
              SessionEvent.Research.StageReopened,
              {
                ...input,
                round,
                timestamp: yield* DateTime.now,
              },
              input.sessionID,
              sequence,
            )
            return round
          }),
        ),
      ),
      recordEvidence: Effect.fn("ResearchRun.recordEvidence")((input) =>
        locks.withLock(input.sessionID)(
          Effect.gen(function* () {
            const { run, sequence } = yield* requireRun(input.sessionID, input.runID)
            if (!run.stages.some((stage) => stage.stage === input.stage))
              return yield* transition(input.sessionID, `Research stage ${input.stage} has not started`)
            if (input.supersedes !== undefined && !run.evidence.some((item) => item.id === input.supersedes))
              return yield* transition(input.sessionID, `Unknown superseded evidence ${input.supersedes}`)
            const seen = new Set(run.evidence.map((item) => ResearchEvidence.key(item)))
            const timestamp = yield* DateTime.now
            const recorded: ResearchEvidence.Evidence[] = []
            // Each publish advances the aggregate by one, so the next write expects the seq it returned.
            let expected = sequence
            for (const candidate of input.candidates) {
              if (seen.has(ResearchEvidence.key(candidate))) continue
              seen.add(ResearchEvidence.key(candidate))
              const data = {
                timestamp,
                sessionID: input.sessionID,
                runID: input.runID,
                stage: input.stage,
                evidenceID: ResearchEvidence.createID(),
                collectedSessionID: input.collectedSessionID,
                messageID: input.messageID,
                toolCallID: candidate.toolCallID,
                tool: candidate.tool,
                source: candidate.source,
                excerpt: candidate.excerpt,
                digest: candidate.digest,
                truncated: candidate.truncated,
                ...(input.supersedes === undefined ? {} : { supersedes: input.supersedes }),
              }
              const published = yield* publish(
                SessionEvent.Research.EvidenceRecorded,
                data,
                input.sessionID,
                expected,
              )
              expected = published.durable?.seq ?? expected
              recorded.push(ResearchEvidence.fromEvent(data))
            }
            return recorded as ReadonlyArray<ResearchEvidence.Evidence>
          }),
        ),
      ),
      recordPlan: Effect.fn("ResearchRun.recordPlan")((input) =>
        locks.withLock(input.sessionID)(
          Effect.gen(function* () {
            const { run, sequence } = yield* requireRun(input.sessionID, input.runID)
            if (!run.stages.some((stage) => stage.stage === "plan"))
              return yield* transition(input.sessionID, "Research plan requires the plan stage to have started")
            yield* publish(
              SessionEvent.Research.PlanRecorded,
              {
                ...input,
                timestamp: yield* DateTime.now,
              },
              input.sessionID,
              sequence,
            )
          }),
        ),
      ),
      startSubcollection: Effect.fn("ResearchRun.startSubcollection")((input) =>
        locks.withLock(input.sessionID)(
          Effect.gen(function* () {
            const { run, sequence } = yield* requireRun(input.sessionID, input.runID)
            const stage = run.stages.find((item) => item.stage === "collect")
            if (!stage || stage.status !== "active")
              return yield* transition(input.sessionID, "A subcollection requires the collect stage to be active")
            if (run.subcollections.some((item) => item.sessionID === input.childSessionID))
              return yield* transition(input.sessionID, `Subcollection session ${input.childSessionID} already exists`)
            yield* publish(
              SessionEvent.Research.SubcollectionStarted,
              {
                ...input,
                timestamp: yield* DateTime.now,
              },
              input.sessionID,
              sequence,
            )
          }),
        ),
      ),
      settleSubcollection: Effect.fn("ResearchRun.settleSubcollection")((input) =>
        locks.withLock(input.sessionID)(
          Effect.gen(function* () {
            const { run, sequence } = yield* requireRun(input.sessionID, input.runID)
            if (
              !run.subcollections.some((item) => item.sessionID === input.childSessionID && item.status === "active")
            )
              return yield* transition(input.sessionID, `Subcollection session ${input.childSessionID} is not open`)
            yield* publish(
              SessionEvent.Research.SubcollectionSettled,
              {
                ...input,
                timestamp: yield* DateTime.now,
              },
              input.sessionID,
              sequence,
            )
          }),
        ),
      ),
      complete: Effect.fn("ResearchRun.complete")((input) =>
        locks.withLock(input.sessionID)(
          Effect.gen(function* () {
            const { run, sequence } = yield* requireRun(input.sessionID, input.runID)
            if (run.stage?.stage !== "report" || run.stage.status !== "completed")
              return yield* transition(input.sessionID, "Research can only complete after the report stage")
            yield* publish(
              SessionEvent.Research.Completed,
              {
                ...input,
                timestamp: yield* DateTime.now,
              },
              input.sessionID,
              sequence,
            )
          }),
        ),
      ),
      fail: Effect.fn("ResearchRun.fail")((input) =>
        locks.withLock(input.sessionID)(
          Effect.gen(function* () {
            const { sequence } = yield* requireRun(input.sessionID, input.runID)
            yield* publish(
              SessionEvent.Research.Failed,
              {
                ...input,
                timestamp: yield* DateTime.now,
              },
              input.sessionID,
              sequence,
            )
          }),
        ),
      ),
      resume: Effect.fn("ResearchRun.resume")((input) =>
        locks.withLock(input.sessionID)(
          Effect.gen(function* () {
            const state = yield* snapshot(input.sessionID)
            const run = state.run
            if (!run) return yield* new ResumeUnavailableError({ sessionID: input.sessionID })
            if (input.runID !== undefined && run.id !== input.runID)
              return yield* new RunMismatchError({ sessionID: input.sessionID, expected: run.id, actual: input.runID })
            if (run.status !== "failed")
              return yield* new ResumeUnavailableError({
                sessionID: input.sessionID,
                runID: run.id,
                status: run.status,
              })
            // A run whose report stage completed failed while exporting, so resuming re-runs the
            // export rather than any stage.
            const fromStage =
              stages.find((item) => !run.stages.some((entry) => entry.stage === item.stage && entry.status === "completed"))
                ?.stage ?? "report"
            yield* publish(
              SessionEvent.Research.Resumed,
              {
                sessionID: input.sessionID,
                runID: run.id,
                fromStage,
                timestamp: yield* DateTime.now,
              },
              input.sessionID,
              state.sequence,
            )
            return (yield* current(input.sessionID))!
          }),
        ),
      ),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [EventV2.node, Database.node],
})

/**
 * Replaces by stage identity rather than by position: a reopened stage is rarely the last one
 * started. Before any reopening the active stage is always the last, so this is unchanged for an
 * event stream that predates `StageReopened`.
 */
function replaceStage(state: Info, stage: StageInfo): Info {
  return { ...state, stage, stages: state.stages.map((item) => (item.stage === stage.stage ? stage : item)) }
}

/** The attempts belonging to a stage's current round; every attempt until the stage is reopened. */
export function currentRoundAttempts(stage: StageInfo): ReadonlyArray<Attempt> {
  return stage.attempts.slice(stage.reopenings.at(-1)?.fromAttempt ?? 0)
}

function requireActive(state: Info, event: string) {
  if (state.status !== "active") invalid(state.sessionID, `Research event ${event} occurred after ${state.status}`)
}

function requireStage(state: Info, stage: Stage, role: Role | undefined, event: string) {
  requireActive(state, event)
  if (state.stage?.status !== "active" || state.stage.stage !== stage)
    invalid(state.sessionID, `Research event ${event} does not match active stage ${stage}`)
  if (role !== undefined && state.stage.role !== role)
    invalid(state.sessionID, `Research event ${event} does not match active role ${role}`)
  return state.stage
}

function invalid(sessionID: SessionSchema.ID, message: string): never {
  throw new InvalidHistoryError({ sessionID, message })
}

function transition(sessionID: SessionSchema.ID, message: string) {
  return new InvalidTransitionError({ sessionID, message })
}

function readAll(
  db: Database.Interface["db"],
  sessionID: SessionSchema.ID,
  after = -1,
  accumulated: ReadonlyArray<SessionEvent.Research.DurableEvent> = [],
): Effect.Effect<ReadonlyArray<SessionEvent.Research.DurableEvent>> {
  return EventV2.readAggregate(db, {
    aggregateID: sessionID,
    after,
    limit: 1_000,
    manifest,
  }).pipe(
    Effect.flatMap((page) =>
      page.hasMore
        ? readAll(db, sessionID, page.events.at(-1)?.durable?.seq ?? after, [...accumulated, ...page.events])
        : Effect.succeed([...accumulated, ...page.events]),
    ),
  )
}
