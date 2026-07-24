import { describe, expect, test } from "bun:test"
import type { ResearchEvent } from "../../src/util/research-state"
import { foldResearchEvents } from "../../src/util/research-state"

function event<Type extends ResearchEvent["type"]>(
  seq: number,
  type: Type,
  data: Extract<ResearchEvent, { type: Type }>["data"],
) {
  return {
    id: `evt_${seq}`,
    type,
    data,
    durable: { aggregateID: "ses_test", seq, version: 1 },
  } as Extract<ResearchEvent, { type: Type }>
}

describe("foldResearchEvents", () => {
  test("projects stages, provider fallback, and report completion", () => {
    const base = { timestamp: 1, sessionID: "ses_test", runID: "run_test" }
    const state = foldResearchEvents([
      event(6, "session.next.research.completed", { ...base, reportPath: "/tmp/report.md" }),
      event(1, "session.next.research.started", { ...base, profile: "balanced", question: "Why?" }),
      event(2, "session.next.research.stage.started", {
        ...base,
        stage: "plan",
        role: "planner",
        route: ["openai/primary", "anthropic/backup"],
      }),
      event(3, "session.next.research.provider.attempted", {
        ...base,
        stage: "plan",
        role: "planner",
        turnID: "turn_one",
        entry: "openai/primary",
        attempt: 1,
      }),
      event(4, "session.next.research.provider.attempt.settled", {
        ...base,
        stage: "plan",
        role: "planner",
        turnID: "turn_one",
        entry: "openai/primary",
        attempt: 1,
        outcome: "retryable-failure",
        replaySafe: true,
      }),
      event(5, "session.next.research.stage.completed", { ...base, stage: "plan", messageID: "msg_plan" }),
    ])

    expect(state).toMatchObject({
      id: "run_test",
      status: "completed",
      reportPath: "/tmp/report.md",
      stages: [
        {
          stage: "plan",
          status: "completed",
          messageID: "msg_plan",
          attempts: [{ entry: "openai/primary", status: "retryable-failure", replaySafe: true }],
        },
      ],
    })
  })

  test("keeps only the latest run", () => {
    const first = { timestamp: 1, sessionID: "ses_test", runID: "run_first" }
    const second = { timestamp: 2, sessionID: "ses_test", runID: "run_second" }
    const state = foldResearchEvents([
      event(1, "session.next.research.started", { ...first, profile: "balanced", question: "First" }),
      event(2, "session.next.research.failed", { ...first, message: "failed" }),
      event(3, "session.next.research.started", { ...second, profile: "fast", question: "Second" }),
    ])

    expect(state).toMatchObject({ id: "run_second", status: "active", question: "Second" })
  })

  test("does not duplicate a replayed provider attempt", () => {
    const base = { timestamp: 1, sessionID: "ses_test", runID: "run_test" }
    const attempted = event(3, "session.next.research.provider.attempted", {
      ...base,
      stage: "plan",
      role: "planner",
      turnID: "turn_one",
      entry: "primary/model",
      attempt: 1,
    })
    const state = foldResearchEvents([
      event(1, "session.next.research.started", { ...base, profile: "balanced", question: "Why?" }),
      event(2, "session.next.research.stage.started", {
        ...base,
        stage: "plan",
        role: "planner",
        route: ["primary/model"],
      }),
      attempted,
      attempted,
    ])

    expect(state?.stages[0]?.attempts).toEqual([
      {
        turnID: "turn_one",
        entry: "primary/model",
        attempt: 1,
        status: "active",
      },
    ])
  })
})
