export * as ResearchRoute from "./research-route"

import { LLMError, type ProviderErrorEvent } from "@opencode-ai/llm"
import { Context, Effect, Layer, Schema } from "effect"
import { Catalog } from "./catalog"
import { Config } from "./config"
import { ConfigResearch } from "./config/research"
import { makeLocationNode } from "./effect/app-node"
import { ModelV2 } from "./model"
import { SessionRunnerModel } from "./session/runner/model"

export interface Candidate {
  readonly index: number
  readonly entry: ConfigResearch.RouteEntry
  readonly model: ModelV2.Info
}

export interface Route {
  readonly profile: ConfigResearch.ProfileName
  readonly role: ConfigResearch.Role
  readonly candidates: ReadonlyArray<Candidate>
}

export type AttemptFailure = LLMError | ProviderErrorEvent

export function canFallback(input: {
  readonly failure: AttemptFailure
  readonly assistantStarted: boolean
  readonly sideEffectPending: boolean
}) {
  if (input.assistantStarted || input.sideEffectPending) return false
  if (input.failure instanceof LLMError) return input.failure.retryable
  if (input.failure.classification === "context-overflow") return false
  return input.failure.retryable === true
}

export function next(route: Route, current: Candidate, failure: AttemptFailure, replaySafe: boolean) {
  if (
    !replaySafe ||
    !canFallback({
      failure,
      assistantStarted: false,
      sideEffectPending: false,
    })
  )
    return
  return route.candidates.find((candidate) => candidate.index > current.index)
}

interface Inventory {
  readonly defaultProfile?: ConfigResearch.ProfileName
  readonly profiles: ReadonlyMap<ConfigResearch.ProfileName, ConfigResearch.Profile>
}

export class ProfileNotSelectedError extends Schema.TaggedErrorClass<ProfileNotSelectedError>()(
  "ResearchRoute.ProfileNotSelectedError",
  {},
) {
  override get message() {
    return "No research profile was selected and no default profile is configured."
  }
}

export class ProfileUnavailableError extends Schema.TaggedErrorClass<ProfileUnavailableError>()(
  "ResearchRoute.ProfileUnavailableError",
  {
    profile: Schema.String,
  },
) {
  override get message() {
    return `Research profile is unavailable: ${this.profile}`
  }
}

export class InvalidDefaultProfileError extends Schema.TaggedErrorClass<InvalidDefaultProfileError>()(
  "ResearchRoute.InvalidDefaultProfileError",
  {
    profile: Schema.String,
  },
) {
  override get message() {
    return `Default research profile is not defined: ${this.profile}`
  }
}

export class RouteUnavailableError extends Schema.TaggedErrorClass<RouteUnavailableError>()(
  "ResearchRoute.RouteUnavailableError",
  {
    profile: Schema.String,
    role: ConfigResearch.Role,
    entries: Schema.Array(ConfigResearch.RouteEntry),
  },
) {
  override get message() {
    return `No available model for research profile ${this.profile} role ${this.role}`
  }
}

export type Error =
  | ProfileNotSelectedError
  | ProfileUnavailableError
  | InvalidDefaultProfileError
  | RouteUnavailableError

export interface Interface {
  readonly list: () => Effect.Effect<ReadonlyArray<ConfigResearch.ProfileName>>
  readonly get: (
    profile?: string,
  ) => Effect.Effect<
    { readonly name: ConfigResearch.ProfileName; readonly profile: ConfigResearch.Profile },
    ProfileNotSelectedError | ProfileUnavailableError | InvalidDefaultProfileError
  >
  readonly route: (input: {
    readonly profile?: string
    readonly role: ConfigResearch.Role
  }) => Effect.Effect<Route, Error>
  readonly candidates: (entries: ReadonlyArray<ConfigResearch.RouteEntry>) => Effect.Effect<ReadonlyArray<Candidate>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ResearchRoute") {}

export function load(entries: ReadonlyArray<Config.Entry>): Inventory {
  const profiles = new Map<ConfigResearch.ProfileName, ConfigResearch.Profile>()
  for (const entry of entries) {
    if (entry.type !== "document" || entry.info.research?.profiles === undefined) continue
    for (const [name, profile] of Object.entries(entry.info.research.profiles)) {
      profiles.set(ConfigResearch.ProfileName.make(name), profile)
    }
  }
  const defaultProfile = entries
    .filter((entry): entry is Config.Document => entry.type === "document")
    .findLast((entry) => entry.info.research?.default_profile !== undefined)?.info.research?.default_profile
  return { defaultProfile, profiles }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const catalog = yield* Catalog.Service
    const inventory = load(yield* config.entries())

    const get = Effect.fn("ResearchRoute.get")(function* (profile?: string) {
      const name = profile === undefined ? inventory.defaultProfile : ConfigResearch.ProfileName.make(profile)
      if (name === undefined) return yield* new ProfileNotSelectedError()
      const selected = inventory.profiles.get(name)
      if (!selected && profile === undefined) return yield* new InvalidDefaultProfileError({ profile: name })
      if (!selected) return yield* new ProfileUnavailableError({ profile: name })
      return { name, profile: selected }
    })
    const candidates = Effect.fn("ResearchRoute.candidates")(function* (
      entries: ReadonlyArray<ConfigResearch.RouteEntry>,
    ) {
      const available = new Map(
        (yield* catalog.model.available())
          .filter(SessionRunnerModel.supported)
          .map((model) => [`${model.providerID}/${model.id}`, model]),
      )
      return entries.flatMap((entry, index) => {
        const parsed = ModelV2.parse(entry)
        const model = available.get(`${parsed.providerID}/${parsed.modelID}`)
        return model ? [{ index, entry, model }] : []
      })
    })

    return Service.of({
      list: Effect.fn("ResearchRoute.list")(function* () {
        return [...inventory.profiles.keys()]
      }),
      get,
      candidates,
      route: Effect.fn("ResearchRoute.route")(function* (input) {
        const selected = yield* get(input.profile)
        const entries = selected.profile[input.role]
        const available = yield* candidates(entries)
        if (available.length === 0)
          return yield* new RouteUnavailableError({
            profile: selected.name,
            role: input.role,
            entries,
          })
        return {
          profile: selected.name,
          role: input.role,
          candidates: available,
        }
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, Catalog.node],
})
