import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { makeLocationNode } from "@opencode-ai/core/effect/app-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ResearchBudget } from "@opencode-ai/core/research-budget"
import { ResearchRun } from "@opencode-ai/core/research-run"
import { ResearchSchema } from "@opencode-ai/core/research-schema"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { ResearchStageTool } from "@opencode-ai/core/tool/research-stage"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { Tool } from "@opencode-ai/core/tool/tool"
import { Tools } from "@opencode-ai/core/tool/tools"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_research_stage_tool")

/** What the stand-in retrieval tool returns; a recheck must go through it rather than around it. */
const retrieved = { text: "Throughput reached 240 requests per second." }

/**
 * A stand-in for the tool a collector used, so a recheck has something real to re-run. Registering
 * it here is also the assertion that the recheck reaches the retrieval by name, not by reaching
 * into the network itself.
 */
const retrievalNode = makeLocationNode({
  name: "test/research-recheck-retrieval",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const tools = yield* Tools.Service
      yield* tools
        .register({
          webfetch: Tool.make({
            description: "Test double for the collector's web retrieval",
            input: Schema.Struct({ url: Schema.String, format: Schema.String }),
            output: Schema.Struct({ url: Schema.String, output: Schema.String }),
            toModelOutput: ({ output }) => [{ type: "text", text: output.output }],
            execute: (input) => Effect.succeed({ url: input.url, output: retrieved.text }),
          }),
        })
        .pipe(Effect.orDie)
    }),
  ),
  deps: [ToolRegistry.node],
})

/**
 * Real sessions, because borrowed authority is read from the child's `parent_id` row. A stub would
 * make the test agree with itself about where the parent link comes from.
 */
const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      ResearchRun.node,
      SessionProjector.node,
      SessionStore.node,
      SessionV2.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      ResearchStageTool.node,
      retrievalNode,
    ]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
      [ResearchBudget.node, ResearchBudget.nodeWithoutConfig],
    ],
  ),
)

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

const call = (name: string, input: unknown, id = `call-${name}`) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name, input: input as Record<string, unknown> },
})

/** The same call, made by a session other than the one that owns the run. */
const callAs = (from: typeof sessionID, name: string, input: unknown) => ({
  ...call(name, input, `call-${name}-${from}`),
  sessionID: from,
})

const plan: ResearchSchema.Plan = {
  stage: "plan",
  subquestions: [{ id: "sq1", question: "How fast is it?" }],
  requirements: [
    {
      id: "r1",
      subquestion_id: "sq1",
      description: "Measured throughput",
      source_kinds: ["web"],
      acceptance: "A published benchmark",
    },
  ],
}

/** Drives one stage to completion so the next one may start, mirroring the workflow's own order. */
const finishStage = (
  research: ResearchRun.Interface,
  runID: ResearchRun.ID,
  stage: ResearchRun.Stage,
  on = sessionID,
) =>
  Effect.gen(function* () {
    const role = { plan: "planner", collect: "collector", analyze: "analyst", verify: "verifier", report: "writer" }[
      stage
    ] as ResearchRun.Role
    const messageID = SessionMessage.ID.make(`msg_${stage}`)
    const turnID = ResearchRun.TurnID.make(`turn_${stage}`)
    yield* research.startAttempt({ sessionID: on, runID, stage, role, turnID, entry: `test/${stage}`, attempt: 1 })
    yield* research.settleAttempt({
      sessionID: on,
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
    yield* research.completeStage({ sessionID: on, runID, stage, messageID })
  })

const reach = (stage: ResearchRun.Stage) =>
  Effect.gen(function* () {
    const research = yield* ResearchRun.Service
    const run = yield* research.start({ sessionID, profile: "balanced" as never, question: "Compare systems" })
    const order = ["plan", "collect", "analyze", "verify", "report"] as const
    for (const item of order) {
      const role = { plan: "planner", collect: "collector", analyze: "analyst", verify: "verifier", report: "writer" }[
        item
      ] as ResearchRun.Role
      yield* research.startStage({ sessionID, runID: run.id, stage: item, role, route: [`test/${item}`] })
      if (item === "plan")
        yield* research.recordPlan({
          sessionID,
          runID: run.id,
          messageID: SessionMessage.ID.make("msg_plan"),
          plan: plan as unknown as Readonly<Record<string, unknown>>,
        })
      if (item === stage) return run
      yield* finishStage(research, run.id, item)
    }
    return run
  })

const recordEvidence = (runID: ResearchRun.ID, stage: ResearchRun.Stage) =>
  ResearchRun.Service.use((research) =>
    research.recordEvidence({
      sessionID,
      runID,
      stage,
      collectedSessionID: sessionID,
      messageID: SessionMessage.ID.make(`msg_${stage}`),
      candidates: [
        {
          toolCallID: "call_one",
          tool: "webfetch",
          source: { kind: "web", url: "https://example.test/a" },
          excerpt: "Throughput reached 120 requests per second.",
          digest: "d".repeat(64),
          truncated: false,
        },
      ],
    }),
  )

describe("ResearchStageTool", () => {
  it.effect("registers one submission tool per stage plus the evidence reader and the rechecker", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      expect(
        (yield* toolDefinitions(registry))
          .map((tool) => tool.name)
          .filter((name) => name.startsWith("research_"))
          .sort(),
      ).toEqual([
        "research_analyze",
        "research_collect",
        "research_evidence",
        "research_plan",
        "research_recheck",
        "research_report",
        "research_verify",
      ])
    }),
  )

  it.effect("is selected by permission, since the registry cannot vary a schema per stage", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      // The shape the runner builds for a non-collect stage: deny everything, then name what stays.
      expect(
        (yield* toolDefinitions(registry, [
          { action: "*", resource: "*", effect: "deny" },
          { action: "research_*", resource: "*", effect: "deny" },
          { action: "research_analyze", resource: "*", effect: "allow" },
          { action: "research_evidence", resource: "*", effect: "allow" },
        ]))
          .map((tool) => tool.name)
          .sort(),
      ).toEqual(["research_analyze", "research_evidence"])
      // Outside a research run the tools must not be advertised at all.
      expect(
        (yield* toolDefinitions(registry, [{ action: "research_*", resource: "*", effect: "deny" }])).map(
          (tool) => tool.name,
        ),
      ).toEqual(["webfetch"])
    }),
  )

  it.effect("refuses a submission outside its own active stage", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      expect(yield* executeTool(registry, call("research_plan", plan))).toEqual({
        type: "error",
        value: "This session has no active research run",
      })

      yield* reach("collect")
      expect(yield* executeTool(registry, call("research_plan", plan))).toEqual({
        type: "error",
        value: "The active research stage is collect, not plan",
      })
    }),
  )

  it.effect("rejects a plan whose identifiers do not line up", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* reach("plan")

      expect(
        yield* executeTool(
          registry,
          call("research_plan", {
            ...plan,
            requirements: [{ ...plan.requirements[0]!, subquestion_id: "sq9" }],
          }),
        ),
      ).toEqual({ type: "error", value: "Requirement r1 references unknown subquestion sq9" })
      expect(
        yield* executeTool(
          registry,
          call("research_plan", {
            ...plan,
            requirements: [plan.requirements[0]!, plan.requirements[0]!],
          }),
        ),
      ).toEqual({ type: "error", value: "Identifier r1 is used more than once" })
      expect(yield* executeTool(registry, call("research_plan", plan))).toEqual({
        type: "text",
        value: "Recorded the plan result. The stage is finished; stop here.",
      })
    }),
  )

  it.effect("requires a coverage verdict for every requirement the plan defined", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* reach("collect")
      const collected = { stage: "collect", summary: "Gathered", coverage: [] as unknown[] }

      expect(
        yield* executeTool(registry, {
          ...call("research_collect", {
            ...collected,
            coverage: [{ requirement_id: "r9", status: "satisfied", sources: [] }],
          }),
        }),
      ).toEqual({
        type: "error",
        value: "Unknown requirement identifiers: r9. Use the requirement identifiers from the plan.",
      })
      expect(
        yield* executeTool(
          registry,
          call("research_collect", {
            ...collected,
            coverage: [{ requirement_id: "r1", status: "unmet", sources: [], note: "Nothing published" }],
          }),
        ),
      ).toEqual({ type: "text", value: "Recorded the collect result. The stage is finished; stop here." })
    }),
  )

  it.effect("rejects citations the run never recorded and accepts the ones it did", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const run = yield* reach("analyze")
      const analysis = (id: string) => ({
        stage: "analyze",
        findings: [{ claim: "It is fast", evidence_ids: [id], confidence: "medium" }],
        conflicts: [],
        gaps: [],
      })

      expect(yield* executeTool(registry, call("research_analyze", analysis("ev_missing")))).toEqual({
        type: "error",
        value:
          "Unknown evidence identifiers: ev_missing. Cite only identifiers listed in the evidence index, which is currently empty.",
      })

      const recorded = yield* recordEvidence(run.id, "analyze")
      expect(yield* executeTool(registry, call("research_analyze", analysis(recorded[0]!.id)))).toEqual({
        type: "text",
        value: "Recorded the analyze result. The stage is finished; stop here.",
      })
    }),
  )

  it.effect("reads stored excerpts by identifier", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const run = yield* reach("analyze")
      const recorded = yield* recordEvidence(run.id, "analyze")

      expect(yield* executeTool(registry, call("research_evidence", { ids: ["ev_missing"] }))).toEqual({
        type: "error",
        value: "Unknown evidence identifiers: ev_missing",
      })
      expect(yield* executeTool(registry, call("research_evidence", { ids: [recorded[0]!.id] }))).toEqual({
        type: "text",
        value: `### ${recorded[0]!.id} · https://example.test/a\n\nThroughput reached 120 requests per second.`,
      })
    }),
  )

  it.effect("rechecks a recorded source by re-running the tool that first retrieved it", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const research = yield* ResearchRun.Service
      const run = yield* reach("verify")
      const recorded = yield* recordEvidence(run.id, "verify")

      // The input is an identifier, never a URL: nothing a prompt writes can name a new source.
      expect(yield* executeTool(registry, call("research_recheck", { id: "ev_missing" }))).toEqual({
        type: "error",
        value: "Unknown evidence identifier: ev_missing",
      })

      const result = yield* executeTool(registry, call("research_recheck", { id: recorded[0]!.id }))
      expect(result.type).toBe("text")
      expect(result.value).toContain(`The source changed since ${recorded[0]!.id} was collected.`)
      expect(result.value).toContain(retrieved.text)

      const evidence = (yield* research.current(sessionID))!.evidence
      expect(evidence).toHaveLength(2)
      expect(evidence.at(-1)).toMatchObject({
        stage: "verify",
        tool: "webfetch",
        source: { kind: "web", url: "https://example.test/a" },
        supersedes: recorded[0]!.id,
        excerpt: retrieved.text,
      })
    }),
  )

  it.effect("refuses a recheck outside the verify stage", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const run = yield* reach("analyze")
      const recorded = yield* recordEvidence(run.id, "analyze")

      expect(yield* executeTool(registry, call("research_recheck", { id: recorded[0]!.id }))).toEqual({
        type: "error",
        value: "The active research stage is analyze, not verify",
      })
    }),
  )

  /**
   * A subcollector has no run of its own. The grant is the parent's open subcollection and nothing
   * else, so a sibling that merely shares the `parentID` gets no stage, and the bucket the parent
   * dealt is exactly what the child answers for.
   */
  it.effect("lets a named child collect for its bucket alone, and only while its subcollection is open", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const sessions = yield* SessionV2.Service
      const research = yield* ResearchRun.Service
      const parent = yield* sessions.create({ location })
      const child = yield* sessions.create({ location, parentID: parent.id })
      const sibling = yield* sessions.create({ location, parentID: parent.id })

      const split = {
        ...plan,
        requirements: [
          plan.requirements[0]!,
          { ...plan.requirements[0]!, id: "r2", description: "Stated method", acceptance: "A published method" },
        ],
      } satisfies ResearchSchema.Plan
      const run = yield* research.start({
        sessionID: parent.id,
        profile: "balanced" as never,
        question: "Compare systems",
      })
      yield* research.startStage({
        sessionID: parent.id,
        runID: run.id,
        stage: "plan",
        role: "planner",
        route: ["test/plan"],
      })
      yield* research.recordPlan({
        sessionID: parent.id,
        runID: run.id,
        messageID: SessionMessage.ID.make("msg_plan"),
        plan: split as unknown as Readonly<Record<string, unknown>>,
      })
      yield* finishStage(research, run.id, "plan", parent.id)
      yield* research.startStage({
        sessionID: parent.id,
        runID: run.id,
        stage: "collect",
        role: "collector",
        route: ["test/collect"],
      })
      yield* research.startSubcollection({
        sessionID: parent.id,
        runID: run.id,
        childSessionID: child.id,
        round: 1,
        requirementIDs: ["r1"],
      })

      const collected = (coverage: ReadonlyArray<string>) => ({
        stage: "collect",
        summary: "Gathered",
        coverage: coverage.map((id) => ({ requirement_id: id, status: "satisfied", sources: [] })),
      })

      // Sharing a parent grants nothing: only a subcollection the parent itself opened does.
      expect(yield* executeTool(registry, callAs(sibling.id, "research_collect", collected(["r1", "r2"])))).toEqual({
        type: "error",
        value: "This session has no active research run",
      })

      // The child is held to its bucket, not to a requirement another collector was given.
      expect(yield* executeTool(registry, callAs(child.id, "research_collect", collected(["r2"])))).toEqual({
        type: "error",
        value: "Every requirement needs a coverage verdict. Missing: r1.",
      })
      expect(yield* executeTool(registry, callAs(child.id, "research_collect", collected(["r1"])))).toEqual({
        type: "text",
        value: "Recorded the collect result. The stage is finished; stop here.",
      })
      // The parent still answers for the whole plan.
      expect(yield* executeTool(registry, callAs(parent.id, "research_collect", collected(["r1"])))).toEqual({
        type: "error",
        value: "Every requirement needs a coverage verdict. Missing: r2.",
      })

      // Settling withdraws the grant, so a child cannot keep submitting after its bucket closed.
      yield* research.settleSubcollection({
        sessionID: parent.id,
        runID: run.id,
        childSessionID: child.id,
        outcome: "succeeded",
      })
      expect(yield* executeTool(registry, callAs(child.id, "research_collect", collected(["r1"])))).toEqual({
        type: "error",
        value: "This session has no active research run",
      })
    }),
  )
})
