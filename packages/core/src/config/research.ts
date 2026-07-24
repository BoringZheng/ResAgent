export * as ConfigResearch from "./research"

import { Schema } from "effect"

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

export class Info extends Schema.Class<Info>("ConfigV2.Research")({
  default_profile: ProfileName.pipe(Schema.optional),
  profiles: Schema.Record(ProfileName, Profile).pipe(Schema.optional),
}) {}
