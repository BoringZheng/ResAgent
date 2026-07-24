import { describe, expect } from "bun:test"
import { LLMError, LLMEvent, ProviderInternalReason, AuthenticationReason } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Config } from "@opencode-ai/core/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ResearchRoute } from "@opencode-ai/core/research-route"
import { testEffect } from "./lib/effect"

const decode = Schema.decodeUnknownSync(Config.Info)
const profile = {
  planner: ["missing/first", "openai/gpt-5", "anthropic/claude-sonnet"],
  collector: ["openai/gpt-5"],
  analyst: ["openai/gpt-5"],
  verifier: ["anthropic/claude-sonnet"],
  writer: ["missing/writer"],
}
const document = (info: unknown) => new Config.Document({ type: "document", info: decode(info) })
const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed([
        document({
          research: {
            default_profile: "balanced",
            profiles: {
              balanced: {
                ...profile,
                writer: ["missing/old"],
              },
            },
          },
        }),
        document({
          research: {
            profiles: {
              balanced: profile,
              fast: { ...profile, planner: ["anthropic/claude-sonnet"] },
            },
          },
        }),
      ]),
  }),
)
const models = [
  ModelV2.Info.make({
    ...ModelV2.Info.empty(ProviderV2.ID.openai, ModelV2.ID.make("gpt-5")),
    api: {
      id: ModelV2.ID.make("gpt-5"),
      type: "aisdk",
      package: "@ai-sdk/openai",
      settings: {},
    },
  }),
  ModelV2.Info.make({
    ...ModelV2.Info.empty(ProviderV2.ID.anthropic, ModelV2.ID.make("claude-sonnet")),
    api: {
      id: ModelV2.ID.make("claude-sonnet"),
      type: "aisdk",
      package: "@ai-sdk/anthropic",
      settings: {},
    },
  }),
]
const catalog = Layer.succeed(
  Catalog.Service,
  Catalog.Service.of({
    provider: {
      get: () => Effect.succeed(undefined),
      all: () => Effect.succeed([]),
      available: () => Effect.succeed([]),
    },
    model: {
      get: () => Effect.succeed(undefined),
      all: () => Effect.succeed(models),
      available: () => Effect.succeed(models),
      default: () => Effect.succeed(undefined),
      small: () => Effect.succeed(undefined),
    },
    transform: () => Effect.die("unused"),
    reload: () => Effect.die("unused"),
  }),
)
const layer = AppNodeBuilder.build(ResearchRoute.node, [
  [Config.node, config],
  [Catalog.node, catalog],
])
const it = testEffect(layer)

describe("ResearchRoute", () => {
  it.effect("loads profiles with complete replacement and preserves candidate order", () =>
    Effect.gen(function* () {
      const routes = yield* ResearchRoute.Service

      expect(yield* routes.list()).toEqual(["balanced", "fast"])
      expect(yield* routes.candidates(profile.planner as never)).toMatchObject([
        { index: 1, entry: "openai/gpt-5" },
        { index: 2, entry: "anthropic/claude-sonnet" },
      ])
      expect(yield* routes.route({ role: "planner" })).toMatchObject({
        profile: "balanced",
        role: "planner",
        candidates: [
          { index: 1, entry: "openai/gpt-5", model: { providerID: "openai", id: "gpt-5" } },
          {
            index: 2,
            entry: "anthropic/claude-sonnet",
            model: { providerID: "anthropic", id: "claude-sonnet" },
          },
        ],
      })
      expect(yield* routes.route({ profile: "fast", role: "planner" })).toMatchObject({
        profile: "fast",
        candidates: [{ index: 0, entry: "anthropic/claude-sonnet" }],
      })
    }),
  )

  it.effect("reports missing profiles and routes with no available models", () =>
    Effect.gen(function* () {
      const routes = yield* ResearchRoute.Service

      expect(yield* routes.get("missing").pipe(Effect.flip)).toBeInstanceOf(ResearchRoute.ProfileUnavailableError)
      expect(yield* routes.route({ role: "writer" }).pipe(Effect.flip)).toMatchObject({
        _tag: "ResearchRoute.RouteUnavailableError",
        profile: "balanced",
        role: "writer",
      })
    }),
  )
})

describe("ResearchRoute load", () => {
  const invalidConfig = Layer.succeed(
    Config.Service,
    Config.Service.of({
      entries: () =>
        Effect.succeed([
          document({
            research: {
              default_profile: "missing",
              profiles: { balanced: profile },
            },
          }),
        ]),
    }),
  )
  const invalid = testEffect(
    AppNodeBuilder.build(ResearchRoute.node, [
      [Config.node, invalidConfig],
      [Catalog.node, catalog],
    ]),
  )

  invalid.effect("rejects a default profile that is not defined", () =>
    Effect.gen(function* () {
      const routes = yield* ResearchRoute.Service
      expect(yield* routes.get().pipe(Effect.flip)).toBeInstanceOf(ResearchRoute.InvalidDefaultProfileError)
    }),
  )
})

describe("ResearchRoute fallback policy", () => {
  const retryable = new LLMError({
    module: "test",
    method: "stream",
    reason: new ProviderInternalReason({
      message: "temporarily unavailable",
      status: 503,
    }),
  })
  const authentication = new LLMError({
    module: "test",
    method: "stream",
    reason: new AuthenticationReason({
      message: "invalid key",
      kind: "invalid",
    }),
  })

  expect(
    ResearchRoute.canFallback({
      failure: retryable,
      assistantStarted: false,
      sideEffectPending: false,
    }),
  ).toBe(true)
  expect(
    ResearchRoute.canFallback({
      failure: retryable,
      assistantStarted: true,
      sideEffectPending: false,
    }),
  ).toBe(false)
  expect(
    ResearchRoute.canFallback({
      failure: authentication,
      assistantStarted: false,
      sideEffectPending: false,
    }),
  ).toBe(false)
  expect(
    ResearchRoute.canFallback({
      failure: LLMEvent.providerError({
        message: "prompt too long",
        classification: "context-overflow",
        retryable: true,
      }),
      assistantStarted: false,
      sideEffectPending: false,
    }),
  ).toBe(false)
  expect(
    ResearchRoute.canFallback({
      failure: LLMEvent.providerError({
        message: "temporarily unavailable",
        retryable: true,
      }),
      assistantStarted: false,
      sideEffectPending: false,
    }),
  ).toBe(true)
})
