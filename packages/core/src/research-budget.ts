export * as ResearchBudget from "./research-budget"

import { Context, Effect, Layer, Option } from "effect"
import { Config } from "./config"
import { ConfigResearch } from "./config/research"
import { makeLocationNode } from "./effect/app-node"

/**
 * The resolved ceilings of a research run. Config states them per field and omits the rest, so
 * every consumer reads a fully resolved record rather than repeating the same defaults.
 */
export interface Limits {
  readonly maxCost: number
  readonly maxTokens: number
  /** Provider steps one stage round may take. Each step may carry several tool calls. */
  readonly maxToolCallsPerStage: number
  readonly maxRecollectRounds: number
  readonly maxRechecks: number
  readonly maxParallelCollectors: number
}

/**
 * Chosen so a default run costs about as much as one already did before budgets existed: the step
 * ceiling was hardcoded at 6, which turned out to be the reason collection ran out of tools before
 * it ran out of requirements, so it is the one default that is deliberately larger than before.
 */
export const defaults: Limits = {
  maxCost: 5,
  maxTokens: 2_000_000,
  maxToolCallsPerStage: 24,
  maxRecollectRounds: 1,
  maxRechecks: 8,
  maxParallelCollectors: 1,
}

/** Later documents win per field, matching how the rest of the research configuration merges. */
export function load(entries: ReadonlyArray<Config.Entry>): Limits {
  const budgets = entries.flatMap((entry) =>
    entry.type === "document" && entry.info.research?.budget !== undefined ? [entry.info.research.budget] : [],
  )
  const pick = <K extends keyof ConfigResearch.Budget>(key: K) =>
    budgets.findLast((budget) => budget[key] !== undefined)?.[key]
  return {
    maxCost: pick("max_cost") ?? defaults.maxCost,
    maxTokens: pick("max_tokens") ?? defaults.maxTokens,
    maxToolCallsPerStage: pick("max_tool_calls_per_stage") ?? defaults.maxToolCallsPerStage,
    maxRecollectRounds: pick("max_recollect_rounds") ?? defaults.maxRecollectRounds,
    maxRechecks: pick("max_rechecks") ?? defaults.maxRechecks,
    maxParallelCollectors: pick("max_parallel_collectors") ?? defaults.maxParallelCollectors,
  }
}

/**
 * Step ceiling for the plan stage. Tools are withdrawn on the last step, so this allows three
 * tool-bearing steps: up to two rounds of read-only reconnaissance, then the submission. It is not
 * configurable — planning is meant to be cheap, and a plan that needs a wide search is a sign the
 * question wants splitting rather than that the ceiling wants raising.
 */
export const reconSteps = 4

/** The step ceiling that applies to one stage, which is the plan stage's own or the configured one. */
export function steps(limits: Limits, stage: string) {
  return stage === "plan" ? reconSteps : limits.maxToolCallsPerStage
}

export interface Interface {
  readonly limits: Limits
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ResearchBudget") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Effect.serviceOption(Config.Service)
    if (Option.isNone(config)) return Service.of({ limits: defaults })
    return Service.of({ limits: load(yield* config.value.entries()) })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node],
})

/**
 * The defaults with nothing to read them from. A tool test that needs a ceiling should not have to
 * stand up configuration — and through it a whole Location — to get one.
 */
export const nodeWithoutConfig = makeLocationNode({
  service: Service,
  layer,
  deps: [],
})
