import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Config } from "@opencode-ai/core/config"
import { ConfigMigrateV1 } from "@opencode-ai/core/v1/config/migrate"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"

const decode = Schema.decodeUnknownSync(Config.Info)

describe("ConfigRemote", () => {
  test("decodes bounded SSH host configuration", () => {
    expect(
      decode({
        remotes: {
          "lab-a": {
            host: "lab-a.example.net",
            user: "research",
            port: 2222,
            identity_file: "~/.ssh/id_ed25519",
            known_hosts_file: "~/.ssh/known_hosts",
            host_key: "strict",
            proxy_jump: "bastion@example.net",
            connect_timeout: 12,
            command_timeout: 30000,
            max_concurrency: 3,
            tags: ["lab", "linux"],
          },
        },
      }).remotes,
    ).toEqual({
      "lab-a": {
        host: "lab-a.example.net",
        user: "research",
        port: 2222,
        identity_file: "~/.ssh/id_ed25519",
        known_hosts_file: "~/.ssh/known_hosts",
        host_key: "strict",
        proxy_jump: "bastion@example.net",
        connect_timeout: 12,
        command_timeout: 30000,
        max_concurrency: 3,
        tags: ["lab", "linux"],
      },
    })
  })

  test("rejects invalid aliases, option-like hosts, and unbounded values", () => {
    expect(() => decode({ remotes: { "bad alias": { host: "example.net" } } })).toThrow()
    expect(() => decode({ remotes: { lab: { host: "-oProxyCommand=bad" } } })).toThrow()
    expect(() => decode({ remotes: { lab: { host: "example.net", port: 70000 } } })).toThrow()
    expect(() => decode({ remotes: { lab: { host: "example.net", connect_timeout: 61 } } })).toThrow()
    expect(() => decode({ remotes: { lab: { host: "example.net", command_timeout: 600001 } } })).toThrow()
    expect(() => decode({ remotes: { lab: { host: "example.net", max_concurrency: 17 } } })).toThrow()
  })

  test("preserves remotes when migrating a config with legacy keys", () => {
    const legacy = Schema.decodeUnknownSync(ConfigV1.Info)({
      provider: {},
      remotes: {
        lab: {
          host: "lab.example.net",
          user: "research",
        },
      },
    })
    expect(ConfigMigrateV1.migrate(legacy).remotes).toEqual({
      lab: {
        host: "lab.example.net",
        user: "research",
      },
    })
  })
})
