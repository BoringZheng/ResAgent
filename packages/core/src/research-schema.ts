export * as ResearchSchema from "./research-schema"

import { Schema } from "effect"

// Identifiers the model invents for plan items. Kept narrow so later stages can reference them
// without ambiguity and so referential integrity is checkable.
export const ItemID = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/))

export const EvidenceIDRef = Schema.String.check(Schema.isPattern(/^ev_[A-Za-z0-9]+$/))

export const SourceKind = Schema.Literals(["web", "file", "search", "remote"])
export type SourceKind = typeof SourceKind.Type

// A source the collector claims to have consulted. Resolved against harvested evidence after the
// turn, so a claimed source that was never fetched is detectable.
export const SourceRef = Schema.Union(
  [
    Schema.Struct({ kind: Schema.Literal("web"), url: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("file"), path: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("search"), query: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("remote"), alias: Schema.String, command: Schema.String }),
  ],
  { mode: "oneOf" },
).pipe(Schema.toTaggedUnion("kind"))
export type SourceRef = typeof SourceRef.Type

export const Subquestion = Schema.Struct({
  id: ItemID.annotate({ description: "Stable identifier for this subquestion" }),
  question: Schema.NonEmptyString,
  rationale: Schema.String.pipe(Schema.optional),
})

export const Requirement = Schema.Struct({
  id: ItemID.annotate({ description: "Stable identifier referenced by every later stage" }),
  subquestion_id: ItemID,
  description: Schema.NonEmptyString.annotate({ description: "What evidence must be obtained" }),
  source_kinds: Schema.Array(SourceKind).check(Schema.isMinLength(1)),
  acceptance: Schema.NonEmptyString.annotate({ description: "What makes this requirement satisfied" }),
})
export type Requirement = typeof Requirement.Type

export const Plan = Schema.Struct({
  stage: Schema.Literal("plan"),
  subquestions: Schema.Array(Subquestion).check(Schema.isMinLength(1)),
  requirements: Schema.Array(Requirement).check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  targets: Schema.Struct({
    hosts: Schema.Array(Schema.String).pipe(Schema.optional),
    paths: Schema.Array(Schema.String).pipe(Schema.optional),
    queries: Schema.Array(Schema.String).pipe(Schema.optional),
  }).pipe(Schema.optional),
})
export type Plan = typeof Plan.Type

export const Coverage = Schema.Struct({
  requirement_id: ItemID,
  status: Schema.Literals(["satisfied", "partial", "unmet"]),
  // The collector cites sources rather than evidence IDs because evidence is harvested from its
  // own tool calls only after the turn settles.
  sources: Schema.Array(SourceRef),
  note: Schema.String.pipe(Schema.optional),
})
export type Coverage = typeof Coverage.Type

export const Collect = Schema.Struct({
  stage: Schema.Literal("collect"),
  summary: Schema.NonEmptyString.annotate({ description: "What was gathered, in Markdown" }),
  coverage: Schema.Array(Coverage).check(Schema.isMinLength(1)),
})
export type Collect = typeof Collect.Type

export const Gap = Schema.Struct({
  requirement_id: ItemID,
  what_is_missing: Schema.NonEmptyString,
  suggested_action: Schema.NonEmptyString,
})
export type Gap = typeof Gap.Type

export const Finding = Schema.Struct({
  claim: Schema.NonEmptyString,
  evidence_ids: Schema.Array(EvidenceIDRef),
  confidence: Schema.Literals(["high", "medium", "low"]),
})

export const Analyze = Schema.Struct({
  stage: Schema.Literal("analyze"),
  findings: Schema.Array(Finding).check(Schema.isMinLength(1)),
  conflicts: Schema.Array(
    Schema.Struct({
      description: Schema.NonEmptyString,
      evidence_ids: Schema.Array(EvidenceIDRef),
    }),
  ),
  gaps: Schema.Array(Gap),
})
export type Analyze = typeof Analyze.Type

export const Verify = Schema.Struct({
  stage: Schema.Literal("verify"),
  assessments: Schema.Array(
    Schema.Struct({
      claim: Schema.NonEmptyString,
      verdict: Schema.Literals(["supported", "unsupported", "conditional"]),
      rationale: Schema.NonEmptyString,
      evidence_ids: Schema.Array(EvidenceIDRef),
    }),
  ).check(Schema.isMinLength(1)),
  gaps: Schema.Array(Gap),
})
export type Verify = typeof Verify.Type

export const Report = Schema.Struct({
  stage: Schema.Literal("report"),
  markdown: Schema.NonEmptyString.annotate({
    description: "The final report body in Markdown, with no surrounding code fence",
  }),
  citations: Schema.Array(
    Schema.Struct({
      claim: Schema.NonEmptyString,
      evidence_ids: Schema.Array(EvidenceIDRef).check(Schema.isMinLength(1)),
    }),
  ),
  limitations: Schema.Array(Schema.String),
})
export type Report = typeof Report.Type

export const StageResult = Schema.Union([Plan, Collect, Analyze, Verify, Report], { mode: "oneOf" }).pipe(
  Schema.toTaggedUnion("stage"),
)
export type StageResult = typeof StageResult.Type

export const forStage = {
  plan: Plan,
  collect: Collect,
  analyze: Analyze,
  verify: Verify,
  report: Report,
} as const

// Every stage after collect cites stored evidence; used to reject citations that name evidence the
// run never recorded.
export function citedEvidence(result: StageResult): ReadonlyArray<string> {
  if (result.stage === "analyze")
    return [...result.findings.flatMap((item) => item.evidence_ids), ...result.conflicts.flatMap((item) => item.evidence_ids)]
  if (result.stage === "verify") return result.assessments.flatMap((item) => item.evidence_ids)
  if (result.stage === "report") return result.citations.flatMap((item) => item.evidence_ids)
  return []
}

export function gaps(result: StageResult): ReadonlyArray<Gap> {
  if (result.stage === "analyze" || result.stage === "verify") return result.gaps
  return []
}

// Requirement identifiers a stage refers back to; used to reject references the plan never defined.
export function referencedRequirements(result: StageResult): ReadonlyArray<string> {
  if (result.stage === "collect") return result.coverage.map((item) => item.requirement_id)
  return gaps(result).map((item) => item.requirement_id)
}

export function planDefects(plan: Plan): ReadonlyArray<string> {
  const subquestions = new Set(plan.subquestions.map((item) => item.id))
  const duplicates = [
    ...duplicated(plan.subquestions.map((item) => item.id)),
    ...duplicated(plan.requirements.map((item) => item.id)),
  ]
  return [
    ...duplicates.map((id) => `Identifier ${id} is used more than once`),
    ...plan.requirements
      .filter((item) => !subquestions.has(item.subquestion_id))
      .map((item) => `Requirement ${item.id} references unknown subquestion ${item.subquestion_id}`),
  ]
}

function duplicated(ids: ReadonlyArray<string>) {
  return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
}
