import { describe, expect, test } from "bun:test"
import { ResearchRun } from "@opencode-ai/core/research-run"
import { ResearchWorkflow } from "@opencode-ai/core/research-workflow"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionV2 } from "@opencode-ai/core/session"
import { DateTime } from "effect"

const sessionID = SessionV2.ID.make("ses_workflow")
const run: ResearchRun.Info = {
  id: ResearchRun.ID.make("run_test"),
  sessionID,
  profile: "balanced" as never,
  question: "Compare systems",
  status: "active",
  stages: [
    {
      stage: "plan",
      role: "planner",
      route: ["primary/model", "backup/model"],
      attempts: [
        {
          turnID: ResearchRun.TurnID.make("turn_plan"),
          entry: "primary/model",
          attempt: 1,
          status: "retryable-failure",
          replaySafe: true,
        },
        {
          turnID: ResearchRun.TurnID.make("turn_plan"),
          entry: "backup/model",
          attempt: 2,
          status: "succeeded",
          replaySafe: false,
        },
      ],
      status: "completed",
      messageID: SessionMessage.ID.make("msg_plan"),
    },
    {
      stage: "report",
      role: "writer",
      route: ["writer/model"],
      attempts: [
        {
          turnID: ResearchRun.TurnID.make("turn_report"),
          entry: "writer/model",
          attempt: 1,
          status: "succeeded",
          replaySafe: false,
        },
      ],
      status: "completed",
      messageID: SessionMessage.ID.make("msg_report"),
    },
  ],
}
const assistant = (id: string, providerID: string, modelID: string, text: string): SessionMessage.Assistant =>
  SessionMessage.Assistant.make({
    id: SessionMessage.ID.make(id),
    type: "assistant",
    agent: "build",
    model: {
      providerID: providerID as never,
      id: modelID as never,
    },
    content: [SessionMessage.AssistantText.make({ type: "text", id: `${id}_text`, text })],
    finish: "stop",
    time: { created: DateTime.makeUnsafe(0), completed: DateTime.makeUnsafe(0) },
  })

describe("ResearchWorkflow", () => {
  test("builds stage-specific prompts", () => {
    expect(ResearchWorkflow.prompt("plan", "Why?")).toContain("research plan")
    expect(ResearchWorkflow.prompt("plan", "Why?")).toContain("Do not ask the user questions")
    expect(ResearchWorkflow.prompt("collect", "Why?")).toContain("Stop using tools once you have sufficient evidence")
    expect(ResearchWorkflow.prompt("verify", "Why?")).toContain("Challenge unsupported claims")
    expect(ResearchWorkflow.prompt("report", "Why?")).toContain("final Markdown report")
  })

  test("renders writer output and durable provenance", () => {
    expect(
      ResearchWorkflow.render({
        run,
        outputs: [
          { stage: "plan", message: assistant("msg_plan", "backup", "model", "Plan") },
          { stage: "report", message: assistant("msg_report", "writer", "model", "# Result\n\nConclusion.") },
        ],
      }),
    ).toContain(
      [
        "# Result",
        "",
        "Conclusion.",
        "",
        "## Provenance",
        "",
        "- Research run: `run_test`",
        "- Profile: `balanced`",
      ].join("\n"),
    )
  })

  test("requires writer text", () => {
    expect(ResearchWorkflow.render({ run, outputs: [] })).toBeUndefined()
  })
})
