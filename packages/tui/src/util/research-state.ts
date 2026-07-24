import type { V2Event } from "@opencode-ai/sdk/v2"

export const researchStages = ["plan", "collect", "analyze", "verify", "report"] as const
export type ResearchStage = (typeof researchStages)[number]

type ResearchEventType =
  | "session.next.research.started"
  | "session.next.research.stage.started"
  | "session.next.research.provider.attempted"
  | "session.next.research.provider.attempt.settled"
  | "session.next.research.stage.completed"
  | "session.next.research.completed"
  | "session.next.research.failed"

export type ResearchEvent = Extract<V2Event, { type: ResearchEventType }>

export type ResearchAttempt = {
  turnID: string
  entry: string
  attempt: number
  status: "active" | "succeeded" | "retryable-failure" | "terminal-failure"
  replaySafe?: boolean
  messageID?: string
}

export type ResearchStageState = {
  stage: ResearchStage
  role: "planner" | "collector" | "analyst" | "verifier" | "writer"
  route: string[]
  attempts: ResearchAttempt[]
  status: "active" | "completed"
  messageID?: string
}

export type ResearchState = {
  id: string
  sessionID: string
  profile: string
  question: string
  status: "active" | "completed" | "failed"
  stages: ResearchStageState[]
  reportPath?: string
  error?: string
}

export function isResearchEvent(event: V2Event): event is ResearchEvent {
  return event.type.startsWith("session.next.research.")
}

export function foldResearchEvents(events: ReadonlyArray<ResearchEvent>) {
  const ordered = events.toSorted((a, b) => {
    const left = a.durable?.seq
    const right = b.durable?.seq
    if (left !== undefined && right !== undefined) return left - right
    if (left !== undefined) return -1
    if (right !== undefined) return 1
    return a.data.timestamp - b.data.timestamp
  })
  let state: ResearchState | undefined

  for (const event of ordered) {
    if (event.type === "session.next.research.started") {
      state = {
        id: event.data.runID,
        sessionID: event.data.sessionID,
        profile: event.data.profile,
        question: event.data.question,
        status: "active",
        stages: [],
      }
      continue
    }
    if (!state || state.id !== event.data.runID) continue

    if (event.type === "session.next.research.stage.started") {
      const existing = state.stages.find((item) => item.stage === event.data.stage)
      if (existing) {
        existing.role = event.data.role
        existing.route = [...event.data.route]
        existing.status = "active"
        continue
      }
      state.stages.push({
        stage: event.data.stage,
        role: event.data.role,
        route: [...event.data.route],
        attempts: [],
        status: "active",
      })
      continue
    }
    if (event.type === "session.next.research.completed") {
      state.status = "completed"
      state.reportPath = event.data.reportPath
      continue
    }
    if (event.type === "session.next.research.failed") {
      state.status = "failed"
      state.error = event.data.message
      continue
    }

    const stage = state.stages.find((item) => item.stage === event.data.stage)
    if (!stage) continue

    if (event.type === "session.next.research.provider.attempted") {
      if (
        stage.attempts.some(
          (item) =>
            item.turnID === event.data.turnID && item.entry === event.data.entry && item.attempt === event.data.attempt,
        )
      )
        continue
      stage.attempts.push({
        turnID: event.data.turnID,
        entry: event.data.entry,
        attempt: event.data.attempt,
        status: "active",
      })
      continue
    }
    if (event.type === "session.next.research.provider.attempt.settled") {
      const attempt = stage.attempts.find(
        (item) =>
          item.turnID === event.data.turnID && item.entry === event.data.entry && item.attempt === event.data.attempt,
      )
      if (!attempt) continue
      attempt.status = event.data.outcome
      attempt.replaySafe = event.data.replaySafe
      attempt.messageID = event.data.messageID
      continue
    }
    if (event.type === "session.next.research.stage.completed") {
      stage.status = "completed"
      stage.messageID = event.data.messageID
    }
  }

  return state
}
