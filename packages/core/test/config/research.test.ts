import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Config } from "@opencode-ai/core/config"
import { ConfigMigrateV1 } from "@opencode-ai/core/v1/config/migrate"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"

const decode = Schema.decodeUnknownSync(Config.Info)
const profile = {
  planner: ["anthropic/claude-sonnet", "openai/gpt-5"],
  collector: ["perplexity/sonar"],
  analyst: ["openai/gpt-5"],
  verifier: ["anthropic/claude-sonnet"],
  writer: ["openai/gpt-5"],
}

describe("ConfigResearch", () => {
  test("decodes complete research profiles", () => {
    expect(
      decode({
        research: {
          default_profile: "balanced",
          profiles: { balanced: profile },
        },
      }).research,
    ).toEqual({
      default_profile: "balanced",
      profiles: { balanced: profile },
    })
  })

  test("rejects incomplete, empty, duplicate, and malformed routes", () => {
    expect(() =>
      decode({
        research: {
          profiles: { balanced: { ...profile, writer: undefined } },
        },
      }),
    ).toThrow()
    expect(() =>
      decode({
        research: {
          profiles: { balanced: { ...profile, planner: [] } },
        },
      }),
    ).toThrow()
    expect(() =>
      decode({
        research: {
          profiles: { balanced: { ...profile, planner: ["openai/gpt-5", "openai/gpt-5"] } },
        },
      }),
    ).toThrow()
    expect(() =>
      decode({
        research: {
          profiles: { balanced: { ...profile, planner: ["missing-model-separator"] } },
        },
      }),
    ).toThrow()
    expect(() =>
      decode({
        research: {
          profiles: { balanced: { ...profile, planner: ["openai/g pt"] } },
        },
      }),
    ).toThrow()
    expect(() =>
      decode({
        research: {
          profiles: { balanced: { ...profile, planner: ["openai/gpt\n5"] } },
        },
      }),
    ).toThrow()
  })

  test("preserves research profiles when migrating a config with legacy keys", () => {
    const legacy = Schema.decodeUnknownSync(ConfigV1.Info)({
      provider: {},
      research: {
        default_profile: "balanced",
        profiles: { balanced: profile },
      },
    })
    expect(ConfigMigrateV1.migrate(legacy).research).toEqual({
      default_profile: "balanced",
      profiles: { balanced: profile },
    })
  })
})
