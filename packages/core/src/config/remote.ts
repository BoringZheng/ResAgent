export * as ConfigRemote from "./remote"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

export const Alias = Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/))
export type Alias = typeof Alias.Type

const Hostname = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/))
const Username = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._-]+$/))
const ProxyJump = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._@,:-]*$/))

export class Host extends Schema.Class<Host>("ConfigV2.Remote.Host")({
  host: Hostname,
  user: Username.pipe(Schema.optional),
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })).pipe(Schema.optional),
  identity_file: Schema.NonEmptyString.pipe(Schema.optional),
  known_hosts_file: Schema.NonEmptyString.pipe(Schema.optional),
  host_key: Schema.Literals(["strict", "accept-new"]).pipe(Schema.optional),
  proxy_jump: ProxyJump.pipe(Schema.optional),
  connect_timeout: PositiveInt.check(Schema.isLessThanOrEqualTo(60)).pipe(Schema.optional),
  command_timeout: PositiveInt.check(Schema.isLessThanOrEqualTo(10 * 60 * 1_000)).pipe(Schema.optional),
  max_concurrency: PositiveInt.check(Schema.isLessThanOrEqualTo(16)).pipe(Schema.optional),
  tags: Schema.Array(Schema.NonEmptyString).pipe(Schema.optional),
}) {}

export const Info = Schema.Record(Alias, Host)
export type Info = typeof Info.Type
