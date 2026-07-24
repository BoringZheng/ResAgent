import { describe, expect, test } from "bun:test"
import { parseRemoteRunResult } from "../../src/util/remote-run"

describe("parseRemoteRunResult", () => {
  test("accepts independent host outcomes", () => {
    expect(
      parseRemoteRunResult({
        command: "uname -a",
        results: [
          {
            host: "alpha",
            status: "ok",
            exit: 0,
            duration_ms: 12,
            stdout: "Linux",
            stderr: "",
            truncated: false,
          },
          {
            host: "beta",
            status: "timeout",
            duration_ms: 1000,
            stdout: "",
            stderr: "Command exceeded timeout.",
            truncated: false,
          },
        ],
      }),
    ).toMatchObject({
      command: "uname -a",
      results: [
        { host: "alpha", status: "ok" },
        { host: "beta", status: "timeout" },
      ],
    })
  })

  test("rejects malformed results", () => {
    expect(parseRemoteRunResult({ command: "true", results: [{ host: "alpha", status: "ok" }] })).toBeUndefined()
    expect(parseRemoteRunResult({ command: "true", results: "alpha" })).toBeUndefined()
  })
})
