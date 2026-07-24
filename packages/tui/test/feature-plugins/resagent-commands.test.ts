import { describe, expect, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import RemoteCommands from "../../src/feature-plugins/remote/commands"
import ResearchCommands from "../../src/feature-plugins/research/commands"
import { createTuiPluginApi } from "../fixture/tui-plugin"

async function commands(plugin: typeof RemoteCommands | typeof ResearchCommands) {
  type KeymapLayer = Parameters<TuiPluginApi["keymap"]["registerLayer"]>[0]
  type Command = NonNullable<KeymapLayer["commands"]>[number]
  const registered: Command[] = []
  const api = createTuiPluginApi({
    keymap: {
      registerLayer(layer: KeymapLayer) {
        registered.push(...(layer.commands ?? []))
        return () => {}
      },
    } as TuiPluginApi["keymap"],
  })
  await plugin.tui(api, undefined, {} as never)
  return registered
}

describe("ResAgent TUI commands", () => {
  test("registers research start and report-path commands", async () => {
    expect((await commands(ResearchCommands)).map((item) => item.name)).toEqual([
      "research.start",
      "research.start.output",
    ])
  })

  test("registers the remote host picker", async () => {
    expect((await commands(RemoteCommands)).map((item) => item.name)).toEqual(["remote.hosts"])
  })
})
