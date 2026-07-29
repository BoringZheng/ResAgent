import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Config } from "@opencode-ai/core/config"
import { ResearchBudget } from "@opencode-ai/core/research-budget"

const decode = Schema.decodeUnknownSync(Config.Info)
const document = (info: unknown) => new Config.Document({ type: "document", info: decode(info) })

describe("ResearchBudget", () => {
  test("falls back to the defaults when nothing states a ceiling", () => {
    expect(ResearchBudget.load([])).toEqual(ResearchBudget.defaults)
    expect(ResearchBudget.load([document({ research: { default_profile: "balanced" } })])).toEqual(
      ResearchBudget.defaults,
    )
  })

  /**
   * Later documents win per field rather than wholesale, so a project can raise one ceiling without
   * having to restate the ones it is happy with.
   */
  test("merges stated fields across documents and leaves the rest at their defaults", () => {
    const limits = ResearchBudget.load([
      document({ research: { budget: { max_cost: 1.5, max_rechecks: 2 } } }),
      document({ research: { budget: { max_cost: 12 } } }),
    ])
    expect(limits).toEqual({
      ...ResearchBudget.defaults,
      maxCost: 12,
      maxRechecks: 2,
    })
  })

  test("rejects ceilings that would make a run meaningless", () => {
    expect(() => decode({ research: { budget: { max_cost: 0 } } })).toThrow()
    expect(() => decode({ research: { budget: { max_tool_calls_per_stage: 0 } } })).toThrow()
    expect(() => decode({ research: { budget: { max_recollect_rounds: -1 } } })).toThrow()
    // A ceiling this high is a typo, not an intention, and silently honouring it costs real money.
    expect(() => decode({ research: { budget: { max_tool_calls_per_stage: 5000 } } })).toThrow()
  })

  test("allows turning the optional loops off entirely", () => {
    const limits = ResearchBudget.load([
      document({ research: { budget: { max_recollect_rounds: 0, max_rechecks: 0 } } }),
    ])
    expect(limits.maxRecollectRounds).toBe(0)
    expect(limits.maxRechecks).toBe(0)
  })
})
