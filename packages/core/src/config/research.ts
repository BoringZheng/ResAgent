export * as ConfigResearch from "./research"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt } from "../schema"

export const Role = Schema.Literals(["planner", "collector", "analyst", "verifier", "writer"])
export type Role = typeof Role.Type

export const ProfileName = Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/))
export type ProfileName = typeof ProfileName.Type

export const RouteEntry = Schema.String.check(Schema.isPattern(/^[^\s/]+\/\S+$/))
export type RouteEntry = typeof RouteEntry.Type

const validRoute = Schema.makeFilter<ReadonlyArray<RouteEntry>>((route) => {
  if (route.length === 0) return "Research provider routes must contain at least one model."
  if (route.length > 16) return "Research provider routes may contain at most 16 models."
  if (new Set(route).size !== route.length) return "Research provider routes must not contain duplicate models."
})

export const Route = Schema.Array(RouteEntry).check(validRoute)
export type Route = typeof Route.Type

export class Profile extends Schema.Class<Profile>("ConfigV2.Research.Profile")({
  planner: Route,
  collector: Route,
  analyst: Route,
  verifier: Route,
  writer: Route,
}) {}

/**
 * Ceilings a research run may not cross. Every field is optional and an omitted one takes the
 * default from `ResearchBudget.defaults`; the point of stating them is that a run stops at a
 * declared limit instead of quietly truncating the work it was doing.
 */
export class Budget extends Schema.Class<Budget>("ConfigV2.Research.Budget")({
  max_cost: Schema.Finite.check(Schema.isGreaterThan(0)).pipe(Schema.optional).annotate({
    description: "Total provider spend, in the catalog's currency, a single run may accumulate",
  }),
  max_tokens: PositiveInt.pipe(Schema.optional).annotate({
    description: "Total input, output, reasoning, and cache tokens a single run may accumulate",
  }),
  max_tool_calls_per_stage: PositiveInt.check(Schema.isLessThanOrEqualTo(200)).pipe(Schema.optional).annotate({
    description: "Provider steps one stage round may take; each step may carry several tool calls",
  }),
  max_recollect_rounds: NonNegativeInt.check(Schema.isLessThanOrEqualTo(8)).pipe(Schema.optional).annotate({
    description: "Times a run may reopen collection to close reported gaps",
  }),
  max_rechecks: NonNegativeInt.check(Schema.isLessThanOrEqualTo(64)).pipe(Schema.optional).annotate({
    description: "Times verification may retrieve an already-recorded source again",
  }),
  max_parallel_collectors: PositiveInt.check(Schema.isLessThanOrEqualTo(8)).pipe(Schema.optional).annotate({
    description: "Collection sessions that may run at once",
  }),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Research")({
  default_profile: ProfileName.pipe(Schema.optional),
  profiles: Schema.Record(ProfileName, Profile).pipe(Schema.optional),
  budget: Budget.pipe(Schema.optional).annotate({
    description: "Ceilings a research run may not cross",
  }),
}) {}
