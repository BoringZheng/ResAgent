import { describe, expect, test } from "bun:test"
import { ResearchBudget } from "@opencode-ai/core/research-budget"
import { ResearchRun } from "@opencode-ai/core/research-run"
import { ResearchSchema } from "@opencode-ai/core/research-schema"
import { ResearchWorkflow } from "@opencode-ai/core/research-workflow"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionV2 } from "@opencode-ai/core/session"
import { DateTime, Effect, Option, Schema } from "effect"

const sessionID = SessionV2.ID.make("ses_workflow")
const evidence = {
  id: "ev_one",
  stage: "collect" as const,
  sessionID,
  messageID: SessionMessage.ID.make("msg_collect"),
  toolCallID: "call_one",
  tool: "webfetch",
  source: { kind: "web" as const, url: "https://example.test/a" },
  excerpt: "Throughput reached 120 requests per second.",
  digest: "0123456789abcdef0123456789abcdef",
  truncated: false,
}
const rechecked = {
  ...evidence,
  id: "ev_two",
  stage: "verify" as const,
  messageID: SessionMessage.ID.make("msg_verify"),
  toolCallID: "call_two",
  excerpt: "Throughput reached 240 requests per second.",
  digest: "fedcba9876543210fedcba9876543210",
  supersedes: "ev_one",
}
const run: ResearchRun.Info = {
  id: ResearchRun.ID.make("run_test"),
  sessionID,
  profile: "balanced" as never,
  question: "Compare systems",
  status: "active",
  startedAt: DateTime.makeUnsafe(0),
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
      reopenings: [],
      messageID: SessionMessage.ID.make("msg_plan"),
    },
    {
      stage: "collect",
      role: "collector",
      route: ["primary/model"],
      attempts: [
        {
          turnID: ResearchRun.TurnID.make("turn_collect"),
          entry: "primary/model",
          attempt: 1,
          status: "succeeded",
          replaySafe: false,
        },
        {
          turnID: ResearchRun.TurnID.make("turn_collect2"),
          entry: "primary/model",
          attempt: 1,
          status: "succeeded",
          replaySafe: false,
        },
      ],
      status: "completed",
      reopenings: [{ round: 2, reason: "analyze reported 1 unmet requirement", fromAttempt: 1 }],
      messageID: SessionMessage.ID.make("msg_collect_2"),
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
      reopenings: [],
      messageID: SessionMessage.ID.make("msg_report"),
    },
  ],
  evidence: [evidence, rechecked],
  subcollections: [],
}

const plan: ResearchSchema.Plan = {
  stage: "plan",
  subquestions: [{ id: "sq1", question: "How fast is it?" }],
  requirements: [
    {
      id: "r1",
      subquestion_id: "sq1",
      description: "Measured throughput",
      source_kinds: ["web"],
      acceptance: "A published benchmark number",
    },
  ],
}

const report: ResearchSchema.Report = {
  stage: "report",
  markdown: "# Result\n\nConclusion.",
  citations: [{ claim: "It is fast", evidence_ids: ["ev_one"] }],
  limitations: [],
}

const analysis: ResearchSchema.Analyze = {
  stage: "analyze",
  findings: [{ claim: "It is fast", evidence_ids: ["ev_one"], confidence: "medium" }],
  conflicts: [],
  gaps: [{ requirement_id: "r1", what_is_missing: "A second source", suggested_action: "Fetch the vendor benchmark" }],
}

const message = (id: string, providerID: string, modelID: string, content: SessionMessage.AssistantContent[]) =>
  SessionMessage.Assistant.make({
    id: SessionMessage.ID.make(id),
    type: "assistant",
    agent: "build",
    model: { providerID: providerID as never, id: modelID as never },
    content,
    finish: "stop",
    time: { created: DateTime.makeUnsafe(0), completed: DateTime.makeUnsafe(0) },
  })

const submission = (id: string, tool: string, structured: unknown) =>
  message(id, "writer", "model", [
    SessionMessage.AssistantTool.make({
      type: "tool",
      id: `${id}_call`,
      name: tool,
      state: {
        status: "completed",
        input: structured as Record<string, unknown>,
        content: [],
        structured: structured as Record<string, unknown>,
      },
      time: { created: DateTime.makeUnsafe(0), completed: DateTime.makeUnsafe(0) },
    }),
  ])

const encoded = <A, I>(schema: Schema.Codec<A, I>, value: A) => Effect.runSync(Schema.encodeEffect(schema)(value))

describe("ResearchWorkflow", () => {
  test("builds stage-specific prompts", () => {
    expect(ResearchWorkflow.prompt("plan", "Why?")).toContain("research plan")
    expect(ResearchWorkflow.prompt("plan", "Why?")).toContain("Do not ask the user questions")
    expect(ResearchWorkflow.prompt("plan", "Why?")).toContain("`research_plan` exactly once")
    expect(ResearchWorkflow.prompt("collect", "Why?")).toContain("Stop using tools once you have sufficient evidence")
    expect(ResearchWorkflow.prompt("verify", "Why?")).toContain("Challenge unsupported claims")
    expect(ResearchWorkflow.prompt("report", "Why?")).toContain("final Markdown report")
    expect(ResearchWorkflow.prompt("report", "Why?")).toContain("`research_evidence`")
  })

  test("carries the plan, the evidence index, and prior results instead of message text", () => {
    const built = ResearchWorkflow.prompt("analyze", "Why?", {
      plan,
      evidence: [evidence],
      results: [{ stage: "plan", result: plan }],
    })
    expect(built).toContain("Evidence index:")
    expect(built).toContain("`ev_one` (web) https://example.test/a")
    expect(built).toContain("Throughput reached 120 requests per second.")
    expect(built).toContain("Prior stage: plan")
    expect(built).toContain('"acceptance": "A published benchmark number"')
  })

  test("tells a citing stage when nothing was collected", () => {
    expect(ResearchWorkflow.prompt("verify", "Why?", { evidence: [] })).toContain("No evidence was collected")
    expect(ResearchWorkflow.prompt("collect", "Why?", { evidence: [] })).not.toContain("No evidence was collected")
  })

  test("names the round, the gaps to close, and what the stage submitted before", () => {
    const first = ResearchWorkflow.prompt("collect", "Why?")
    expect(first).not.toContain("This is round")
    expect(first).not.toContain("Unmet requirements to close")

    const again = ResearchWorkflow.prompt("collect", "Why?", {
      round: 2,
      focus: analysis.gaps,
      previous: { stage: "collect", summary: "Gathered", coverage: [] },
    })
    expect(again).toContain("This is round 2 of this stage")
    expect(again).toContain("Unmet requirements to close:")
    expect(again).toContain("- `r1`: A second source → Fetch the vendor benchmark")
    expect(again).toContain("Your previous collect result:")
    expect(again).toContain('"summary": "Gathered"')
  })

  test("offers the rechecker to the verifier alone", () => {    expect(ResearchWorkflow.prompt("verify", "Why?")).toContain("`research_recheck`")
    expect(ResearchWorkflow.prompt("analyze", "Why?")).not.toContain("`research_recheck`")
    expect(ResearchWorkflow.prompt("collect", "Why?")).not.toContain("`research_recheck`")
  })

  /**
   * Splitting is a cost, so it only happens when there is something to split. One bucket is the
   * sequential path, which the workflow must reach without opening a session to get there.
   */
  test("splits requirements round-robin and refuses to split into one bucket", () => {
    const requirement = (id: string, subquestion: string): ResearchSchema.Requirement => ({
      id,
      subquestion_id: subquestion,
      description: `Evidence for ${id}`,
      source_kinds: ["web"],
      acceptance: "A published number",
    })
    const five = ["r1", "r2", "r3", "r4", "r5"].map((id, index) => requirement(id, `sq${index < 3 ? 1 : 2}`))

    expect(ResearchWorkflow.buckets(five, 1)).toEqual([])
    expect(ResearchWorkflow.buckets(five, 0)).toEqual([])
    expect(ResearchWorkflow.buckets([requirement("r1", "sq1")], 4)).toEqual([])
    // Dealt, not sliced: requirements ordered by subquestion spread rather than pile onto one.
    expect(ResearchWorkflow.buckets(five, 2).map((group) => group.map((item) => item.id))).toEqual([
      ["r1", "r3", "r5"],
      ["r2", "r4"],
    ])
    // Never more buckets than requirements, so no subcollector is opened with nothing to do.
    expect(ResearchWorkflow.buckets(five, 9).length).toBe(5)
  })

  test("scopes a subcollector to its bucket and tells the parent what came back", () => {
    const assigned: ResearchSchema.Requirement[] = [
      {
        id: "r1",
        subquestion_id: "sq1",
        description: "Measured throughput",
        source_kinds: ["web"],
        acceptance: "A published benchmark number",
      },
    ]
    const child = ResearchWorkflow.prompt("collect", "Why?", { plan, assigned })
    expect(child).toContain("Requirements assigned to you:")
    expect(child).toContain("Another collector is working on the rest")
    expect(child).toContain('"acceptance": "A published benchmark number"')
    expect(child).not.toContain("What your subcollectors reported")

    const parent = ResearchWorkflow.prompt("collect", "Why?", {
      plan,
      subcollected: [
        { stage: "collect", summary: "First bucket", coverage: [] },
        { stage: "collect", summary: "Second bucket", coverage: [] },
      ],
    })
    expect(parent).toContain("What your subcollectors reported:")
    expect(parent).toContain("Collection was split across 2 sessions")
    expect(parent).toContain('"summary": "Second bucket"')
    expect(parent).not.toContain("Requirements assigned to you")
  })

  test("selects the durable output from the final successful provider turn", () => {
    expect(ResearchWorkflow.stageOutputMessageID(run, "plan")).toBe(SessionMessage.ID.make("msg_plan"))
    expect(ResearchWorkflow.stageOutputMessageID(run, "report")).toBe(SessionMessage.ID.make("msg_report"))
    // A reopened stage resolves to the round that actually completed it, not to its first round.
    expect(ResearchWorkflow.stageOutputMessageID(run, "collect")).toBe(SessionMessage.ID.make("msg_collect_2"))
    expect(ResearchWorkflow.stageOutputMessageID(run, "verify")).toBeUndefined()
  })

  test("reads the stage result from the settled submission call", () => {
    const result = Effect.runSync(
      ResearchWorkflow.stageResult("report", [
        message("msg_text", "writer", "model", [
          SessionMessage.AssistantText.make({ type: "text", id: "t", text: "thinking out loud" }),
        ]),
        submission("msg_report", "research_report", encoded(ResearchSchema.Report, report)),
      ]),
    )
    expect(Option.isSome(result)).toBeTrue()
    expect(Option.getOrThrow(result)).toMatchObject({ stage: "report", markdown: "# Result\n\nConclusion." })
  })

  test("treats a missing or malformed submission as an unfinished stage", () => {
    expect(
      Option.isNone(
        Effect.runSync(
          ResearchWorkflow.stageResult("report", [
            message("msg_text", "writer", "model", [
              SessionMessage.AssistantText.make({ type: "text", id: "t", text: "# Result" }),
            ]),
          ]),
        ),
      ),
    ).toBeTrue()
    expect(
      Option.isNone(
        Effect.runSync(ResearchWorkflow.stageResult("report", [submission("msg_bad", "research_report", { stage: "report" })])),
      ),
    ).toBeTrue()
  })

  test("renders writer output, evidence provenance, and unmet requirements", () => {
    const rendered = ResearchWorkflow.render({
      run,
      outputs: [
        { stage: "collect", result: { stage: "collect", summary: "Gathered", coverage: [] }, messages: [submission("msg_collect_2", "research_collect", {})] },
        { stage: "analyze", result: analysis, messages: [submission("msg_analyze", "research_analyze", {})] },
        { stage: "report", result: report, messages: [submission("msg_report", "research_report", {})] },
      ],
      limits: ResearchBudget.defaults,
      usage: { total: { cost: 0.25, tokens: 4000 }, byStage: new Map([["analyze", { cost: 0.1, tokens: 1500 }]]) },
    })
    expect(rendered).toContain(["# Result", "", "Conclusion.", "", "## Unmet requirements"].join("\n"))
    expect(rendered).toContain("- `r1` (analyze): A second source → Fetch the vendor benchmark")
    expect(rendered).toContain(["## Provenance", "", "- Research run: `run_test`", "- Profile: `balanced`"].join("\n"))
    expect(rendered).toContain("- `ev_one` (collect, web) https://example.test/a — `0123456789ab`")
    // A reopened stage says why it ran again, and a rechecked row names what it replaced.
    expect(rendered).toContain(["- Rounds:", "  - 2: analyze reported 1 unmet requirement"].join("\n"))
    expect(rendered).toContain("- `ev_two` (verify, web) https://example.test/a — `fedcba987654` — recheck of `ev_one`, changed")
    // What the run spent is stated for the run and for each stage that produced turns.
    expect(rendered).toContain("- Usage: 4000 of 2000000 tokens, cost 0.25 of 5")
    expect(rendered).toContain("- Usage: 1500 tokens, cost 0.1")
  })

  /**
   * Evidence gathered by a child session carries that child's id, so the split it came from is
   * stated outright rather than left to be inferred from a session the report never mentions.
   */
  test("names each subcollection, including one whose child failed", () => {
    const rendered = ResearchWorkflow.render({
      run: {
        ...run,
        subcollections: [
          {
            sessionID: SessionV2.ID.make("ses_childA"),
            round: 1,
            requirementIDs: ["r1", "r3"],
            status: "settled",
            outcome: "succeeded",
          },
          {
            sessionID: SessionV2.ID.make("ses_childB"),
            round: 1,
            requirementIDs: ["r2"],
            status: "settled",
            outcome: "failed",
          },
        ],
      },
      outputs: [{ stage: "report", result: report, messages: [submission("msg_report", "research_report", {})] }],
      limits: ResearchBudget.defaults,
      usage: { total: { cost: 0, tokens: 0 }, byStage: new Map() },
    })
    expect(rendered).toContain(
      [
        "- Subcollections:",
        "  - `ses_childA` (round 1, succeeded): r1, r3",
        "  - `ses_childB` (round 1, failed): r2",
      ].join("\n"),
    )
    // A run that never split says nothing about splitting.
    expect(
      ResearchWorkflow.render({
        run,
        outputs: [{ stage: "report", result: report, messages: [submission("msg_report", "research_report", {})] }],
        limits: ResearchBudget.defaults,
        usage: { total: { cost: 0, tokens: 0 }, byStage: new Map() },
      }),
    ).not.toContain("- Subcollections:")
  })

  /**
   * Reaching the step ceiling withdraws a stage's tools, which used to be invisible: the stage just
   * stopped gathering earlier than its plan called for. It is now stated in provenance.
   */
  test("states a stage that reached the step ceiling", () => {
    const rendered = ResearchWorkflow.render({
      run,
      outputs: [
        {
          stage: "report",
          result: report,
          messages: [submission("msg_report", "research_report", {}), submission("msg_report_2", "research_report", {})],
        },
      ],
      limits: { ...ResearchBudget.defaults, maxToolCallsPerStage: 2 },
      usage: { total: { cost: 0, tokens: 0 }, byStage: new Map() },
    })
    expect(rendered).toContain("- Step ceiling: reached 2; tools were withdrawn for the final step")
  })

  /** The plan stage keeps its own reconnaissance ceiling, so raising the configured one is not it. */
  test("uses the plan stage's own ceiling rather than the configured one", () => {
    const rendered = ResearchWorkflow.render({
      run,
      outputs: [
        {
          stage: "plan",
          result: plan,
          messages: Array.from({ length: ResearchBudget.reconSteps }, (_, index) =>
            submission(`msg_plan_${index}`, "research_plan", {}),
          ),
        },
        { stage: "report", result: report, messages: [submission("msg_report", "research_report", {})] },
      ],
      limits: ResearchBudget.defaults,
      usage: { total: { cost: 0, tokens: 0 }, byStage: new Map() },
    })
    expect(rendered).toContain(`- Step ceiling: reached ${ResearchBudget.reconSteps};`)
    expect(rendered).not.toContain(`- Step ceiling: reached ${ResearchBudget.defaults.maxToolCallsPerStage};`)
  })

  /**
   * Spend is read back from the session's own turns rather than tallied as the run goes, so a
   * resumed run answers for what its earlier attempt already cost.
   */
  test("attributes spend to the stage whose attempt a turn precedes", () => {
    const priced = (id: string, created: number, cost: number, tokens: number) => ({
      ...message(id, "writer", "model", []),
      cost,
      tokens: { input: tokens, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: DateTime.makeUnsafe(created), completed: DateTime.makeUnsafe(created) },
    })
    const settled = (stage: ResearchRun.Stage, messageID: string): ResearchRun.StageInfo => ({
      stage,
      role: "collector",
      route: ["primary/model"],
      attempts: [
        {
          turnID: ResearchRun.TurnID.make(`turn_${stage}1`),
          entry: "primary/model",
          attempt: 1,
          status: "succeeded",
          replaySafe: false,
          messageID: SessionMessage.ID.make(messageID),
        },
      ],
      status: "completed",
      reopenings: [],
      messageID: SessionMessage.ID.make(messageID),
    })
    const spend = ResearchWorkflow.spend(
      {
        ...run,
        startedAt: DateTime.makeUnsafe(10),
        stages: [settled("plan", "msg_plan"), settled("collect", "msg_collect")],
      },
      [
        // Before the run began: another conversation in the same session, not the run's to pay for.
        priced("msg_before", 5, 9, 900),
        priced("msg_plan_step", 11, 1, 100),
        priced("msg_plan", 12, 2, 200),
        priced("msg_collect", 13, 4, 400),
        // A round that never settled: it counts toward the total and belongs to no stage.
        priced("msg_orphan", 14, 8, 800),
      ],
    )
    expect(spend.total).toEqual({ cost: 15, tokens: 1500 })
    expect(spend.byStage.get("plan")).toEqual({ cost: 3, tokens: 300 })
    expect(spend.byStage.get("collect")).toEqual({ cost: 4, tokens: 400 })
    expect(spend.byStage.get("report")).toBeUndefined()
  })

  test("requires a writer result", () => {
    expect(
      ResearchWorkflow.render({
        run,
        outputs: [],
        limits: ResearchBudget.defaults,
        usage: { total: { cost: 0, tokens: 0 }, byStage: new Map() },
      }),
    ).toBeUndefined()
  })
})
