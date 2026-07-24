import { describe, expect, test } from "bun:test"
import { EOL } from "os"
import { renderChecks } from "@/cli/cmd/doctor"

describe("doctor command", () => {
  test("renders stable secret-free status lines", () => {
    expect(
      renderChecks([
        { status: "ok", label: "providers", detail: "2 available provider(s), 4 available model(s)" },
        { status: "warn", label: "remote lab", detail: "host-key=accept-new, identity=present" },
        { status: "fail", label: "report directory", detail: "not writable" },
      ]),
    ).toBe(
      [
        "[ok] providers: 2 available provider(s), 4 available model(s)",
        "[warn] remote lab: host-key=accept-new, identity=present",
        "[fail] report directory: not writable",
      ].join(EOL),
    )
  })
})
