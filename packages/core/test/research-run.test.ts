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
})
