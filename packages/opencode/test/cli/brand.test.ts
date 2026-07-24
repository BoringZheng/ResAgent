import { expect, test } from "bun:test"
import { commandName } from "../../src/cli/brand"

test("uses ResAgent branding only for the standalone distribution", () => {
  expect(commandName({})).toBe("opencode")
  expect(commandName({ RESAGENT_LAUNCH: "1" })).toBe("resagent")
  expect(commandName({ RESAGENT_DISTRIBUTION: "1" })).toBe("resagent")
})
