import { describe, expect, test } from "bun:test"
import { resolveQuestion } from "@/cli/cmd/research"

describe("research command", () => {
  test("combines positional and piped research input", () => {
    expect(resolveQuestion(["compare", "systems"], "with current evidence")).toBe(
      "compare systems\n\nwith current evidence",
    )
  })

  test("rejects empty input through an empty resolved question", () => {
    expect(resolveQuestion([], " \n ")).toBe("")
  })
})
