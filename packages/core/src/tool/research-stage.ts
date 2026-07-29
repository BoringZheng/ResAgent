export * as ResearchStageTool from "./research-stage"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { ResearchBudget } from "../research-budget"
import { ResearchEvidence } from "../research-evidence"
import { ResearchRun } from "../research-run"
import { ResearchSchema } from "../research-schema"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

/**
 * One submission tool per stage. The registry cannot vary a tool's schema per session, so the
 * stage is selected by permission instead: the runner allows exactly the tool of the active stage
 * and denies the rest, which leaves every advertised schema exact rather than a five-way union.
 */
export const stageTools = {
  plan: "research_plan",
  collect: "research_collect",
  analyze: "research_analyze",
  verify: "research_verify",
  report: "research_report",
} as const satisfies Record<ResearchRun.Stage, string>

export const evidenceName = "research_evidence"

export const recheckName = "research_recheck"

export const MAX_EVIDENCE_PER_CALL = 12

export const RecheckInput = Schema.Struct({
  id: ResearchSchema.EvidenceIDRef.annotate({
    description: "The evidence identifier to retrieve again, taken from the evidence index",
  }),
})

export const RecheckOutput = Schema.Struct({
  id: Schema.String.annotate({ description: "The identifier of the newly recorded evidence" }),
  supersedes: Schema.String,
  source: Schema.String,
  changed: Schema.Boolean.annotate({ description: "Whether the retrieved text differs from the recorded one" }),
  excerpt: Schema.String,
  truncated: Schema.Boolean,
})

export const EvidenceInput = Schema.Struct({
  ids: Schema.Array(ResearchSchema.EvidenceIDRef)
    .check(Schema.isMinLength(1), Schema.isMaxLength(MAX_EVIDENCE_PER_CALL))
    .annotate({ description: "Evidence identifiers taken from the evidence index" }),
})

export const EvidenceOutput = Schema.Struct({
  evidence: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      tool: Schema.String,
      source: Schema.String,
      excerpt: Schema.String,
      truncated: Schema.Boolean,
    }),
  ),
})

const descriptions = {
  plan: "Submit the research plan for this stage: the subquestions to answer and the evidence requirements that decide when each is satisfied. This is the only way to finish the plan stage.",
  collect:
    "Submit what this collection stage gathered, including a coverage verdict for every requirement in the plan. Call it once, after the evidence-gathering tool calls are done. This is the only way to finish the collect stage.",
  analyze:
    "Submit the analysis: findings with the evidence that supports them, material conflicts, and the requirements that remain unmet. Cite only evidence identifiers from the evidence index. This is the only way to finish the analyze stage.",
  verify:
    "Submit the verification: a verdict for every claim under review with the evidence that decides it, and the gaps that remain. Cite only evidence identifiers from the evidence index. This is the only way to finish the verify stage.",
  report:
    "Submit the final Markdown report with its citations and limitations. Cite only evidence identifiers from the evidence index. This is the only way to finish the report stage.",
} satisfies Record<ResearchRun.Stage, string>

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const registry = yield* ToolRegistry.Service
    const runs = yield* ResearchRun.Service
    // Every recheck re-runs a real retrieval, so the ceiling exists to stop a verifier from turning
    // one stage into an unbounded crawl.
    const maxRechecks = (yield* ResearchBudget.Service).limits.maxRechecks

    /**
     * The run a call may act on, and the requirements it is answerable for. A subcollector has no
     * run of its own: it borrows its parent's collect stage, and answers only for the bucket the
     * parent opened for it, so it is not held to coverage another collector was given.
     */
    const activeRun = (sessionID: ResearchRun.Info["sessionID"], stage: ResearchRun.Stage) =>
      Effect.gen(function* () {
        const run = yield* runs
          .current(sessionID)
          .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
        if (!run) {
          const borrowed = yield* runs
            .borrowed(sessionID)
            .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
          if (borrowed && borrowed.stage.stage === stage)
            return { run: borrowed.run, requirements: new Set(borrowed.requirementIDs) }
        }
        if (!run || run.status !== "active")
          return yield* new ToolFailure({ message: "This session has no active research run" })
        if (run.stage?.stage !== stage || run.stage.status !== "active")
          return yield* new ToolFailure({
            message: `The active research stage is ${run.stage?.stage ?? "none"}, not ${stage}`,
          })
        return { run, requirements: new Set(planRequirements(run.plan)) }
      })

    // Referential checks run inside the turn, so a bad citation comes back as a tool error the
    // model can still correct rather than as a stage failure after the fact.
    const accept = (
      result: ResearchSchema.StageResult,
      run: ResearchRun.Info,
      requirements: ReadonlySet<string>,
    ) =>
      Effect.gen(function* () {
        const known = new Set(run.evidence.map((item) => item.id))
        const missing = [...new Set(ResearchSchema.citedEvidence(result))].filter((id) => !known.has(id))
        if (missing.length > 0)
          return yield* new ToolFailure({
            message: `Unknown evidence identifiers: ${missing.join(", ")}. Cite only identifiers listed in the evidence index${known.size === 0 ? ", which is currently empty" : ""}.`,
          })
        const planned = new Set(planRequirements(run.plan))
        const unknown = [...new Set(ResearchSchema.referencedRequirements(result))].filter((id) => !planned.has(id))
        if (planned.size > 0 && unknown.length > 0)
          return yield* new ToolFailure({
            message: `Unknown requirement identifiers: ${unknown.join(", ")}. Use the requirement identifiers from the plan.`,
          })
        if (result.stage === "plan") {
          const defects = ResearchSchema.planDefects(result)
          if (defects.length > 0) return yield* new ToolFailure({ message: defects.join("; ") })
        }
        if (result.stage === "collect") {
          const uncovered = [...requirements].filter((id) => !result.coverage.some((item) => item.requirement_id === id))
          if (uncovered.length > 0)
            return yield* new ToolFailure({
              message: `Every requirement needs a coverage verdict. Missing: ${uncovered.join(", ")}.`,
            })
        }
      })

    const stageTool = <S extends Tool.SchemaType<any>>(stage: ResearchRun.Stage, schema: S, description: string) =>
      Tool.make({
        description,
        input: schema,
        output: schema,
        toModelOutput: () => [{ type: "text", text: `Recorded the ${stage} result. The stage is finished; stop here.` }],
        execute: (input, context) =>
          activeRun(context.sessionID, stage).pipe(
            Effect.flatMap((authority) =>
              accept(input as ResearchSchema.StageResult, authority.run, authority.requirements),
            ),
            Effect.map(() => input),
          ),
      })

    yield* tools
      .register({
        [stageTools.plan]: stageTool("plan", ResearchSchema.Plan, descriptions.plan),
        [stageTools.collect]: stageTool("collect", ResearchSchema.Collect, descriptions.collect),
        [stageTools.analyze]: stageTool("analyze", ResearchSchema.Analyze, descriptions.analyze),
        [stageTools.verify]: stageTool("verify", ResearchSchema.Verify, descriptions.verify),
        [stageTools.report]: stageTool("report", ResearchSchema.Report, descriptions.report),
        [evidenceName]: Tool.make({
          description:
            "Read the stored text of collected evidence by identifier. The evidence index lists only a preview; use this to read the part of a source a claim actually depends on.",
          input: EvidenceInput,
          output: EvidenceOutput,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: output.evidence
                .map((item) =>
                  [
                    `### ${item.id} · ${item.source}`,
                    item.excerpt,
                    item.truncated ? "_(truncated)_" : undefined,
                  ]
                    .filter((line) => line !== undefined)
                    .join("\n\n"),
                )
                .join("\n\n"),
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              const own = yield* runs
                .current(context.sessionID)
                .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
              // A subcollector reads the parent run's index; the entries it may read are the same
              // ones the parent listed in its prompt, so borrowing widens nothing.
              const run =
                own ??
                (yield* runs
                  .borrowed(context.sessionID)
                  .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message }))))?.run
              if (!run) return yield* new ToolFailure({ message: "This session has no research run" })
              const found = input.ids.map((id) => run.evidence.find((item) => item.id === id))
              const missing = input.ids.filter((id, index) => found[index] === undefined)
              if (missing.length > 0)
                return yield* new ToolFailure({ message: `Unknown evidence identifiers: ${missing.join(", ")}` })
              return {
                evidence: found.filter((item) => item !== undefined).map((item) => ({
                  id: item.id,
                  tool: item.tool,
                  source: ResearchEvidence.describe(item.source),
                  excerpt: item.excerpt,
                  truncated: item.truncated,
                })),
              }
            }),
        }),
        [recheckName]: Tool.make({
          description:
            "Retrieve one recorded piece of evidence again and report whether the source has changed since it was collected. Takes an evidence identifier, not a URL, path, or host: only sources the collector already retrieved can be rechecked.",
          input: RecheckInput,
          output: RecheckOutput,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: [
                `${output.changed ? "The source changed" : "The source is unchanged"} since ${output.supersedes} was collected.`,
                `Recorded as \`${output.id}\` · ${output.source}`,
                "",
                output.excerpt,
                output.truncated ? "_(truncated)_" : undefined,
              ]
                .filter((line) => line !== undefined)
                .join("\n"),
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              const { run } = yield* activeRun(context.sessionID, "verify")
              const original = run.evidence.find((item) => item.id === input.id)
              if (!original) return yield* new ToolFailure({ message: `Unknown evidence identifier: ${input.id}` })
              const spent = run.evidence.filter((item) => item.supersedes !== undefined).length
              if (spent >= maxRechecks)
                return yield* new ToolFailure({
                  message: `This run has already used all ${maxRechecks} rechecks. Rule on the remaining claims with the evidence on hand.`,
                })
              // Re-running goes through the registered tool, so a remote recheck still asks the
              // same `<alias> <command>` permission the collector was granted.
              const retrieval = ResearchEvidence.retrieval(original.source)
              const toolCallID = `${context.toolCallID}_recheck`
              const settlement = yield* (yield* registry.materialize())
                .settle({
                  sessionID: context.sessionID,
                  agent: context.agent,
                  assistantMessageID: context.assistantMessageID,
                  call: { type: "tool-call", id: toolCallID, name: retrieval.tool, input: retrieval.input },
                })
                .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
              if (settlement.result.type === "error" || !settlement.output)
                return yield* new ToolFailure({
                  message: `Rechecking ${ResearchEvidence.describe(original.source)} with \`${retrieval.tool}\` failed: ${
                    settlement.result.type === "error" ? settlement.result.value : "the tool returned no output"
                  }`,
                })
              const candidate = ResearchEvidence.fromSettled({
                toolCallID,
                tool: retrieval.tool,
                input: retrieval.input,
                structured: settlement.output.structured,
                content: settlement.output.content,
              }).find(
                (item) => ResearchEvidence.sourceKey(item.source) === ResearchEvidence.sourceKey(original.source),
              )
              if (!candidate)
                return yield* new ToolFailure({
                  message: `Rechecking ${ResearchEvidence.describe(original.source)} returned nothing usable`,
                })
              const recorded = yield* runs
                .recordEvidence({
                  sessionID: context.sessionID,
                  runID: run.id,
                  stage: "verify",
                  collectedSessionID: context.sessionID,
                  messageID: context.assistantMessageID,
                  candidates: [candidate],
                  supersedes: original.id,
                })
                .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
              const stored = recorded.at(0)
              if (!stored) return yield* new ToolFailure({ message: `Evidence ${input.id} was already rechecked` })
              return {
                id: stored.id,
                supersedes: original.id,
                source: ResearchEvidence.describe(stored.source),
                changed: stored.digest !== original.digest,
                excerpt: stored.excerpt,
                truncated: stored.truncated,
              }
            }),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/research-stage",
  layer,
  deps: [ToolRegistry.node, ResearchRun.node, ResearchBudget.node],
})

function planRequirements(plan: ResearchRun.Info["plan"]) {
  const requirements = plan?.["requirements"]
  if (!Array.isArray(requirements)) return []
  return requirements.flatMap((item) =>
    typeof item === "object" && item !== null && typeof (item as Record<string, unknown>)["id"] === "string"
      ? [(item as Record<string, unknown>)["id"] as string]
      : [],
  )
}
