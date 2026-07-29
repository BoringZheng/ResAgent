import { describe, expect } from "bun:test"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { DateTime, Effect, Exit } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { ResearchRun } from "@opencode-ai/core/research-run"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionV2 } from "@opencode-ai/core/session"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([ResearchRun.node, EventV2.node])))
const sessionID = SessionV2.ID.make("ses_research_run")

const completeStage = (
  research: ResearchRun.Interface,
  runID: ResearchRun.ID,
  stage: ResearchRun.Stage,
  role: ResearchRun.Role,
) =>
  Effect.gen(function* () {
    const messageID = SessionMessage.ID.make(`msg_${stage}`)
    const turnID = ResearchRun.TurnID.make(`turn_${stage}`)
    yield* research.startStage({
      sessionID,
      runID,
      stage,
      role,
      route: [`test/${stage}`],
    })
    yield* research.startAttempt({
      sessionID,
      runID,
      stage,
      role,
      turnID,
      entry: `test/${stage}`,
      attempt: 1,
    })
    yield* research.settleAttempt({
      sessionID,
      runID,
      stage,
      role,
      turnID,
      entry: `test/${stage}`,
      attempt: 1,
      outcome: "succeeded",
      replaySafe: false,
      messageID,
    })
    yield* research.completeStage({
      sessionID,
      runID,
      stage,
      messageID,
    })
  })

describe("ResearchRun", () => {
  it.effect("persists provider attempt lifecycle and completed research state", () =>
    Effect.gen(function* () {
      const research = yield* ResearchRun.Service
      const started = yield* research.start({
        sessionID,
        profile: "balanced" as never,
        question: "Compare two implementations",
      })
      const turnID = ResearchRun.TurnID.make("turn_plan")

      yield* research.startStage({
        sessionID,
        runID: started.id,
        stage: "plan",
        role: "planner",
        route: ["openai/gpt-5", "anthropic/claude-sonnet"],
      })
      yield* research.startAttempt({
        sessionID,
        runID: started.id,
        stage: "plan",
        role: "planner",
        turnID,
        entry: "openai/gpt-5",
        attempt: 1,
      })
      yield* research.settleAttempt({
        sessionID,
        runID: started.id,
        stage: "plan",
        role: "planner",
        turnID,
        entry: "openai/gpt-5",
        attempt: 1,
        outcome: "retryable-failure",
        replaySafe: true,
      })
      yield* research.startAttempt({
        sessionID,
        runID: started.id,
        stage: "plan",
        role: "planner",
        turnID,
        entry: "anthropic/claude-sonnet",
        attempt: 2,
      })
      yield* research.settleAttempt({
        sessionID,
        runID: started.id,
        stage: "plan",
        role: "planner",
        turnID,
        entry: "anthropic/claude-sonnet",
        attempt: 2,
        outcome: "succeeded",
        replaySafe: false,
        messageID: SessionMessage.ID.make("msg_plan"),
      })
      yield* research.completeStage({
        sessionID,
        runID: started.id,
        stage: "plan",
        messageID: SessionMessage.ID.make("msg_plan"),
      })
      yield* completeStage(research, started.id, "collect", "collector")
      yield* completeStage(research, started.id, "analyze", "analyst")
      yield* completeStage(research, started.id, "verify", "verifier")
      yield* completeStage(research, started.id, "report", "writer")
      yield* research.complete({
        sessionID,
        runID: started.id,
        reportPath: "/reports/result.md",
      })

      const current = yield* research.current(sessionID)
      expect(current).toMatchObject({
        id: started.id,
        profile: "balanced",
        question: "Compare two implementations",
        status: "completed",
        reportPath: "/reports/result.md",
      })
      expect(current?.stages[0]).toMatchObject({
        stage: "plan",
        role: "planner",
        status: "completed",
        messageID: "msg_plan",
        attempts: [
          {
            turnID: "turn_plan",
            entry: "openai/gpt-5",
            attempt: 1,
            status: "retryable-failure",
            replaySafe: true,
          },
          {
            turnID: "turn_plan",
            entry: "anthropic/claude-sonnet",
            attempt: 2,
            status: "succeeded",
            replaySafe: false,
          },
        ],
      })
    }),
  )

  it.effect("rejects invalid stage and provider transitions", () =>
    Effect.gen(function* () {
      const research = yield* ResearchRun.Service
      const run = yield* research.start({
        sessionID,
        profile: "balanced" as never,
        question: "Validate transitions",
      })

      expect(
        yield* research
          .startStage({
            sessionID,
            runID: run.id,
            stage: "collect",
            role: "collector",
            route: ["test/model"],
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(ResearchRun.InvalidTransitionError)

      yield* research.startStage({
        sessionID,
        runID: run.id,
        stage: "plan",
        role: "planner",
        route: ["test/model"],
      })
      const turnID = ResearchRun.TurnID.make("turn_unsettled")
      yield* research.startAttempt({
        sessionID,
        runID: run.id,
        stage: "plan",
        role: "planner",
        turnID,
        entry: "test/model",
        attempt: 1,
      })

      expect(
        yield* research
          .completeStage({
            sessionID,
            runID: run.id,
            stage: "plan",
            messageID: SessionMessage.ID.make("msg_invalid"),
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(ResearchRun.InvalidTransitionError)
      expect(
        yield* research
          .startAttempt({
            sessionID,
            runID: run.id,
            stage: "plan",
            role: "planner",
            turnID: ResearchRun.TurnID.make("turn_other"),
            entry: "test/model",
            attempt: 1,
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(ResearchRun.IndeterminateAttemptError)

      yield* research.fail({ sessionID, runID: run.id, message: "test cleanup" })
      expect(yield* research.fail({ sessionID, runID: run.id, message: "again" }).pipe(Effect.flip)).toBeInstanceOf(
        ResearchRun.InvalidTransitionError,
      )
    }),
  )

  it.effect("requires stage completion to reference a successful provider message", () =>
    Effect.gen(function* () {
      const research = yield* ResearchRun.Service
      const run = yield* research.start({
        sessionID,
        profile: "balanced" as never,
        question: "Require successful stage output",
      })
      const turnID = ResearchRun.TurnID.make("turn_failed")
      yield* research.startStage({
        sessionID,
        runID: run.id,
        stage: "plan",
        role: "planner",
        route: ["test/model"],
      })

      expect(
        yield* research
          .completeStage({
            sessionID,
            runID: run.id,
            stage: "plan",
            messageID: SessionMessage.ID.make("msg_missing"),
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(ResearchRun.InvalidTransitionError)

      yield* research.startAttempt({
        sessionID,
        runID: run.id,
        stage: "plan",
        role: "planner",
        turnID,
        entry: "test/model",
        attempt: 1,
      })
      yield* research.settleAttempt({
        sessionID,
        runID: run.id,
        stage: "plan",
        role: "planner",
        turnID,
        entry: "test/model",
        attempt: 1,
        outcome: "terminal-failure",
        replaySafe: false,
      })

      expect(
        yield* research
          .completeStage({
            sessionID,
            runID: run.id,
            stage: "plan",
            messageID: SessionMessage.ID.make("msg_failed"),
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(ResearchRun.InvalidTransitionError)
    }),
  )

  it.effect("serializes concurrent starts for one session", () =>
    Effect.gen(function* () {
      const research = yield* ResearchRun.Service
      const exits = yield* Effect.all(
        [
          research.start({ sessionID, profile: "balanced" as never, question: "First" }).pipe(Effect.exit),
          research.start({ sessionID, profile: "balanced" as never, question: "Second" }).pipe(Effect.exit),
        ],
        { concurrency: "unbounded" },
      )

      expect(exits.filter(Exit.isSuccess)).toHaveLength(1)
      expect(exits.filter(Exit.isFailure)).toHaveLength(1)
      expect(yield* research.current(sessionID)).toMatchObject({ status: "active", stages: [] })
    }),
  )

  it.effect(
    "reads current state across aggregate pagination boundaries",
    () =>
      Effect.gen(function* () {
        const research = yield* ResearchRun.Service
        const events = yield* EventV2.Service
        yield* Effect.forEach(
          Array.from({ length: 500 }, (_, index) => index),
          (index) =>
            events
              .publish(SessionEvent.Research.Started, {
                sessionID,
                runID: `run_page${index}`,
                profile: "balanced",
                question: `Archived ${index}`,
                timestamp: DateTime.makeUnsafe(index * 2),
              })
              .pipe(
                Effect.andThen(
                  events.publish(SessionEvent.Research.Failed, {
                    sessionID,
                    runID: `run_page${index}`,
                    message: "archived",
                    timestamp: DateTime.makeUnsafe(index * 2 + 1),
                  }),
                ),
              ),
          { concurrency: 1, discard: true },
        )
        yield* events.publish(SessionEvent.Research.Started, {
          sessionID,
          runID: "run_current",
          profile: "balanced",
          question: "Current after page boundary",
          timestamp: DateTime.makeUnsafe(1_001),
        })

        expect(yield* research.current(sessionID)).toMatchObject({
          id: "run_current",
          question: "Current after page boundary",
          status: "active",
        })
      }),
    15_000,
  )

  /**
   * The event stream is append-only by decision: a run durably written before evidence and plan
   * events existed must still fold to exactly the state it folded to then. This asserts the whole
   * projection, not a subset, so any change to an existing branch's semantics fails here.
   */
  it.effect("folds a stream that predates the evidence and plan events unchanged", () =>
    Effect.gen(function* () {
      const research = yield* ResearchRun.Service
      const events = yield* EventV2.Service
      const legacy = SessionV2.ID.make("ses_research_legacy")
      const roles = [
        ["plan", "planner"],
        ["collect", "collector"],
        ["analyze", "analyst"],
        ["verify", "verifier"],
        ["report", "writer"],
      ] as const
      let clock = 0
      const at = () => DateTime.makeUnsafe(clock++)
      yield* events.publish(SessionEvent.Research.Started, {
        sessionID: legacy,
        runID: "run_legacy",
        profile: "balanced",
        question: "Does an old run still fold?",
        timestamp: at(),
      })
      for (const [stage, role] of roles) {
        yield* events.publish(SessionEvent.Research.StageStarted, {
          sessionID: legacy,
          runID: "run_legacy",
          stage,
          role,
          route: ["test/primary", "test/backup"],
          timestamp: at(),
        })
        yield* events.publish(SessionEvent.Research.ProviderAttempted, {
          sessionID: legacy,
          runID: "run_legacy",
          stage,
          role,
          turnID: `turn_${stage}`,
          entry: "test/primary",
          attempt: 1,
          timestamp: at(),
        })
        yield* events.publish(SessionEvent.Research.ProviderAttemptSettled, {
          sessionID: legacy,
          runID: "run_legacy",
          stage,
          role,
          turnID: `turn_${stage}`,
          entry: "test/primary",
          attempt: 1,
          outcome: "succeeded",
          replaySafe: false,
          messageID: SessionMessage.ID.make(`msg_${stage}`),
          timestamp: at(),
        })
        yield* events.publish(SessionEvent.Research.StageCompleted, {
          sessionID: legacy,
          runID: "run_legacy",
          stage,
          messageID: SessionMessage.ID.make(`msg_${stage}`),
          timestamp: at(),
        })
      }
      yield* events.publish(SessionEvent.Research.Completed, {
        sessionID: legacy,
        runID: "run_legacy",
        reportPath: "/reports/legacy.md",
        timestamp: at(),
      })

      const folded: ResearchRun.StageInfo[] = roles.map(([stage, role]) => ({
        stage,
        role,
        route: ["test/primary", "test/backup"],
        attempts: [
          {
            turnID: ResearchRun.TurnID.make(`turn_${stage}`),
            entry: "test/primary",
            attempt: 1,
            status: "succeeded",
            replaySafe: false,
            messageID: SessionMessage.ID.make(`msg_${stage}`),
          },
        ],
        status: "completed",
        // A stream with no `StageReopened` still folds to a single round.
        reopenings: [],
        messageID: SessionMessage.ID.make(`msg_${stage}`),
      }))
      expect(yield* research.current(legacy)).toEqual({
        id: ResearchRun.ID.make("run_legacy"),
        sessionID: legacy,
        profile: "balanced" as never,
        question: "Does an old run still fold?",
        status: "completed",
        reportPath: "/reports/legacy.md",
        // Derived from the `Started` event the old stream already carried, not from a new one.
        startedAt: DateTime.makeUnsafe(0),
        stages: folded,
        stage: folded.at(-1),
        evidence: [],
        // A stream with no `SubcollectionStarted` folds to a run that never split collection.
        subcollections: [],
      })
    }),
  )

  it.effect("records harvested evidence once per tool call and source", () =>
    Effect.gen(function* () {
      const research = yield* ResearchRun.Service
      const evidenceSession = SessionV2.ID.make("ses_research_evidence")
      const run = yield* research.start({
        sessionID: evidenceSession,
        profile: "balanced" as never,
        question: "Record evidence",
      })
      const candidate = {
        toolCallID: "call_one",
        tool: "webfetch",
        source: { kind: "web" as const, url: "https://example.test/a" },
        excerpt: "body",
        digest: "d".repeat(64),
        truncated: false,
      }

      expect(
        yield* research
          .recordEvidence({
            sessionID: evidenceSession,
            runID: run.id,
            stage: "collect",
            collectedSessionID: evidenceSession,
            messageID: SessionMessage.ID.make("msg_collect"),
            candidates: [candidate],
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(ResearchRun.InvalidTransitionError)

      yield* research.startStage({
        sessionID: evidenceSession,
        runID: run.id,
        stage: "plan",
        role: "planner",
        route: ["test/model"],
      })
      const recorded = yield* research.recordEvidence({
        sessionID: evidenceSession,
        runID: run.id,
        stage: "plan",
        collectedSessionID: evidenceSession,
        messageID: SessionMessage.ID.make("msg_plan"),
        candidates: [candidate, { ...candidate, toolCallID: "call_two" }],
      })
      expect(recorded).toHaveLength(2)

      // Replaying the same turn must not duplicate rows, so a retried harvest is safe.
      expect(
        yield* research.recordEvidence({
          sessionID: evidenceSession,
          runID: run.id,
          stage: "plan",
          collectedSessionID: evidenceSession,
          messageID: SessionMessage.ID.make("msg_plan"),
          candidates: [candidate],
        }),
      ).toEqual([])
      expect((yield* research.current(evidenceSession))?.evidence.map((item) => item.id)).toEqual(
        recorded.map((item) => item.id),
      )
    }),
  )

  it.effect("keeps the plan outside the message history and lets a later write supersede it", () =>
    Effect.gen(function* () {
      const research = yield* ResearchRun.Service
      const planSession = SessionV2.ID.make("ses_research_plan")
      const run = yield* research.start({
        sessionID: planSession,
        profile: "balanced" as never,
        question: "Record a plan",
      })

      expect(
        yield* research
          .recordPlan({
            sessionID: planSession,
            runID: run.id,
            messageID: SessionMessage.ID.make("msg_plan"),
            plan: { stage: "plan" },
          })
          .pipe(Effect.flip),
      ).toBeInstanceOf(ResearchRun.InvalidTransitionError)

      yield* research.startStage({
        sessionID: planSession,
        runID: run.id,
        stage: "plan",
        role: "planner",
        route: ["test/model"],
      })
      yield* research.recordPlan({
        sessionID: planSession,
        runID: run.id,
        messageID: SessionMessage.ID.make("msg_plan"),
        plan: { stage: "plan", requirements: [{ id: "r1" }] },
      })
      yield* research.recordPlan({
        sessionID: planSession,
        runID: run.id,
        messageID: SessionMessage.ID.make("msg_plan_v2"),
        plan: { stage: "plan", requirements: [{ id: "r1" }, { id: "r2" }] },
      })

      expect((yield* research.current(planSession))?.plan).toEqual({
        stage: "plan",
        requirements: [{ id: "r1" }, { id: "r2" }],
      })
    }),
  )

  it.effect("reopens a completed stage for another round without restarting it", () =>
    Effect.gen(function* () {
      const research = yield* ResearchRun.Service
      const reopenSession = SessionV2.ID.make("ses_research_reopen")
      const run = yield* research.start({
        sessionID: reopenSession,
        profile: "balanced" as never,
        question: "Close a gap",
      })
      const round = (stage: ResearchRun.Stage, role: ResearchRun.Role, suffix: string) =>
        Effect.gen(function* () {
          const turnID = ResearchRun.TurnID.make(`turn_${suffix}`)
          const messageID = SessionMessage.ID.make(`msg_${suffix}`)
          yield* research.startAttempt({ sessionID: reopenSession, runID: run.id, stage, role, turnID, entry: "test/model", attempt: 1 })
          yield* research.settleAttempt({
            sessionID: reopenSession,
            runID: run.id,
            stage,
            role,
            turnID,
            entry: "test/model",
            attempt: 1,
            outcome: "succeeded",
            replaySafe: false,
            messageID,
          })
          yield* research.completeStage({ sessionID: reopenSession, runID: run.id, stage, messageID })
          return messageID
        })

      yield* research.startStage({ sessionID: reopenSession, runID: run.id, stage: "plan", role: "planner", route: ["test/model"] })
      yield* round("plan", "planner", "plan")
      yield* research.startStage({ sessionID: reopenSession, runID: run.id, stage: "collect", role: "collector", route: ["test/model"] })
      const first = yield* round("collect", "collector", "collect1")

      // A stage that never completed, and a stage that is not there at all, cannot be reopened.
      expect(
        yield* research
          .reopenStage({ sessionID: reopenSession, runID: run.id, stage: "analyze", reason: "no" })
          .pipe(Effect.flip),
      ).toBeInstanceOf(ResearchRun.InvalidTransitionError)

      expect(
        yield* research.reopenStage({ sessionID: reopenSession, runID: run.id, stage: "collect", reason: "analyze reported 1 unmet requirement" }),
      ).toBe(2)
      const reopened = yield* research.current(reopenSession)
      expect(reopened?.stages.map((item) => item.stage)).toEqual(["plan", "collect"])
      expect(reopened?.stage).toMatchObject({
        stage: "collect",
        status: "active",
        messageID: undefined,
        reopenings: [{ round: 2, reason: "analyze reported 1 unmet requirement", fromAttempt: 1 }],
      })

      // The earlier round's message is no longer a valid completion: a round closes on its own turn.
      expect(
        yield* research
          .completeStage({ sessionID: reopenSession, runID: run.id, stage: "collect", messageID: first })
          .pipe(Effect.flip),
      ).toBeInstanceOf(ResearchRun.InvalidTransitionError)

      const second = yield* round("collect", "collector", "collect2")
      const settled = yield* research.current(reopenSession)
      expect(settled?.stages.map((item) => item.stage)).toEqual(["plan", "collect"])
      expect(settled?.stages.at(-1)).toMatchObject({ status: "completed", messageID: second })
      // Attempts stay a flat history, so provenance still shows both rounds.
      expect(settled?.stages.at(-1)?.attempts).toHaveLength(2)
      expect(ResearchRun.currentRoundAttempts(settled!.stages.at(-1)!).map((item) => item.messageID)).toEqual([second])
    }),
  )

  it.effect("resumes a failed run at the first stage that never completed", () =>
    Effect.gen(function* () {
      const research = yield* ResearchRun.Service
      const session = SessionV2.ID.make("ses_research_resume")

      // Nothing to resume yet: the session has never had a run.
      expect(yield* research.resume({ sessionID: session }).pipe(Effect.flip)).toBeInstanceOf(
        ResearchRun.ResumeUnavailableError,
      )

      const run = yield* research.start({
        sessionID: session,
        profile: "balanced" as never,
        question: "Survive a failure",
      })
      const messageID = SessionMessage.ID.make("msg_plan")
      const turnID = ResearchRun.TurnID.make("turn_plan")
      yield* research.startStage({ sessionID: session, runID: run.id, stage: "plan", role: "planner", route: ["test/model"] })
      yield* research.startAttempt({ sessionID: session, runID: run.id, stage: "plan", role: "planner", turnID, entry: "test/model", attempt: 1 })
      yield* research.settleAttempt({
        sessionID: session,
        runID: run.id,
        stage: "plan",
        role: "planner",
        turnID,
        entry: "test/model",
        attempt: 1,
        outcome: "succeeded",
        replaySafe: false,
        messageID,
      })
      yield* research.recordPlan({ sessionID: session, runID: run.id, messageID, plan: { subquestions: [] } })
      yield* research.completeStage({ sessionID: session, runID: run.id, stage: "plan", messageID })
      yield* research.startStage({ sessionID: session, runID: run.id, stage: "collect", role: "collector", route: ["test/model"] })

      // An active run is not resumable: resuming is what a failure earns, not a way to restart.
      expect(yield* research.resume({ sessionID: session }).pipe(Effect.flip)).toBeInstanceOf(
        ResearchRun.ResumeUnavailableError,
      )

      yield* research.fail({ sessionID: session, runID: run.id, message: "collector went away" })
      // A resume that names the wrong run is refused rather than silently redirected.
      expect(
        yield* research.resume({ sessionID: session, runID: ResearchRun.ID.make("run_other") }).pipe(Effect.flip),
      ).toBeInstanceOf(ResearchRun.RunMismatchError)

      const resumed = yield* research.resume({ sessionID: session, runID: run.id })
      expect(resumed).toMatchObject({ id: run.id, status: "active", error: undefined })
      // Everything the failed attempt established stands, so resuming pays only for what was lost.
      expect(resumed.plan).toEqual({ subquestions: [] })
      expect(resumed.stages.map((item) => [item.stage, item.status])).toEqual([
        ["plan", "completed"],
        ["collect", "active"],
      ])
      expect(resumed.stages[0]?.messageID).toBe(messageID)
    }),
  )

  /**
   * A child session collects on the parent's behalf, so the parent's stream is where the grant
   * lives. `subcollectionStage` is the whole of that authority: pointing `parentID` at a research
   * session buys nothing, because only an open entry the parent itself wrote hands over the stage.
   */
  it.effect("grants a named child the collect stage and withdraws it on settlement", () =>
    Effect.gen(function* () {
      const research = yield* ResearchRun.Service
      const parent = SessionV2.ID.make("ses_research_fanout")
      const childA = SessionV2.ID.make("ses_research_child_a")
      const childB = SessionV2.ID.make("ses_research_child_b")
      const stranger = SessionV2.ID.make("ses_research_stranger")
      const run = yield* research.start({ sessionID: parent, profile: "balanced" as never, question: "Split it" })

      // Collection cannot be split before there is a collect stage to split.
      expect(
        yield* research
          .startSubcollection({ sessionID: parent, runID: run.id, childSessionID: childA, round: 1, requirementIDs: ["r1"] })
          .pipe(Effect.flip),
      ).toBeInstanceOf(ResearchRun.InvalidTransitionError)

      yield* research.startStage({ sessionID: parent, runID: run.id, stage: "plan", role: "planner", route: ["test/model"] })
      expect(
        yield* research
          .startSubcollection({ sessionID: parent, runID: run.id, childSessionID: childA, round: 1, requirementIDs: ["r1"] })
          .pipe(Effect.flip),
      ).toBeInstanceOf(ResearchRun.InvalidTransitionError)

      const planMessage = SessionMessage.ID.make("msg_fanout_plan")
      const planTurn = ResearchRun.TurnID.make("turn_fanoutplan")
      yield* research.startAttempt({ sessionID: parent, runID: run.id, stage: "plan", role: "planner", turnID: planTurn, entry: "test/model", attempt: 1 })
      yield* research.settleAttempt({
        sessionID: parent,
        runID: run.id,
        stage: "plan",
        role: "planner",
        turnID: planTurn,
        entry: "test/model",
        attempt: 1,
        outcome: "succeeded",
        replaySafe: false,
        messageID: planMessage,
      })
      yield* research.completeStage({ sessionID: parent, runID: run.id, stage: "plan", messageID: planMessage })
      yield* research.startStage({ sessionID: parent, runID: run.id, stage: "collect", role: "collector", route: ["test/model"] })
      yield* research.startSubcollection({ sessionID: parent, runID: run.id, childSessionID: childA, round: 1, requirementIDs: ["r1", "r3"] })
      yield* research.startSubcollection({ sessionID: parent, runID: run.id, childSessionID: childB, round: 1, requirementIDs: ["r2"] })

      // The same child cannot be enlisted twice, so a bucket has exactly one collector.
      expect(
        yield* research
          .startSubcollection({ sessionID: parent, runID: run.id, childSessionID: childA, round: 1, requirementIDs: ["r4"] })
          .pipe(Effect.flip),
      ).toBeInstanceOf(ResearchRun.InvalidTransitionError)

      const split = (yield* research.current(parent))!
      expect(split.subcollections).toEqual([
        { sessionID: childA, round: 1, requirementIDs: ["r1", "r3"], status: "active", outcome: undefined },
        { sessionID: childB, round: 1, requirementIDs: ["r2"], status: "active", outcome: undefined },
      ])
      // A named child borrows the collect stage, but with no attempts: it records nothing of its own.
      expect(ResearchRun.subcollectionStage(split, childA)).toMatchObject({
        stage: "collect",
        status: "active",
        attempts: [],
      })
      expect(ResearchRun.subcollectionStage(split, stranger)).toBeUndefined()

      // Settling withdraws the authority whether the child gathered anything or not.
      yield* research.settleSubcollection({ sessionID: parent, runID: run.id, childSessionID: childA, outcome: "succeeded" })
      yield* research.settleSubcollection({ sessionID: parent, runID: run.id, childSessionID: childB, outcome: "failed" })
      expect(
        yield* research
          .settleSubcollection({ sessionID: parent, runID: run.id, childSessionID: childA, outcome: "succeeded" })
          .pipe(Effect.flip),
      ).toBeInstanceOf(ResearchRun.InvalidTransitionError)

      const settled = (yield* research.current(parent))!
      expect(settled.subcollections.map((item) => [item.status, item.outcome])).toEqual([
        ["settled", "succeeded"],
        ["settled", "failed"],
      ])
      expect(ResearchRun.subcollectionStage(settled, childA)).toBeUndefined()
      expect(ResearchRun.subcollectionStage(settled, childB)).toBeUndefined()
    }),
  )
})

