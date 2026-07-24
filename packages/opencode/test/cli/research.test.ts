import { describe, expect, test } from "bun:test"
import { formatToolProgress, resolveQuestion } from "@/cli/cmd/research"

describe("research command", () => {
  test("combines positional and piped research input", () => {
    expect(resolveQuestion(["compare", "systems"], "with current evidence")).toBe(
      "compare systems\n\nwith current evidence",
    )
  })

  test("rejects empty input through an empty resolved question", () => {
    expect(resolveQuestion([], " \n ")).toBe("")
  })

  test("formats visible progress for local and remote tools", () => {
    expect(formatToolProgress("websearch", { query: "evidence" })).toBe("tool · websearch")
    expect(formatToolProgress("remote_run", { hosts: ["tor-client", 42, "tor-hs"] })).toBe(
      "remote · tor-client, tor-hs",
    )
    expect(formatToolProgress("remote_run", {})).toBe("remote · configured targets")
  })
})
