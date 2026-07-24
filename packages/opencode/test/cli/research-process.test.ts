import { describe, expect } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { cliIt } from "../lib/cli-process"
import { testProviderConfig } from "../lib/test-provider"

describe("opencode research (subprocess)", () => {
  cliIt.live(
    "runs five durable stages and exports the final report",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const canary = `resagent-secret-${crypto.randomUUID()}`
        yield* llm.text("Plan")
        yield* llm.text("Evidence")
        yield* llm.text("Analysis")
        yield* llm.text("Verification")
        yield* llm.text("# Final report\n\nVerified conclusion.")
        const provider = testProviderConfig(llm.url)
        const config = {
          ...provider,
          research: {
            default_profile: "balanced",
            profiles: {
              balanced: {
                planner: ["test/test-model"],
                collector: ["test/test-model"],
                analyst: ["test/test-model"],
                verifier: ["test/test-model"],
                writer: ["test/test-model"],
              },
            },
          },
        }

        const result = yield* opencode.spawn(["research", "What", "is", "the", "result?"], {
          timeoutMs: 60_000,
          env: {
            OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
            RESAGENT_SECRET_CANARY: canary,
          },
        })
        opencode.expectExit(result, 0, "research")
        expect(result.stdout).toContain("# Final report")
        expect(result.stdout).toContain("## Provenance")
        expect(result.stderr).toContain("stage plan")
        expect(result.stderr).toContain("provider 1 · test/test-model")
        expect(result.stderr).toContain("Report")
        expect(result.stdout).not.toContain(canary)
        expect(result.stderr).not.toContain(canary)

        const reports = [...new Bun.Glob("*.md").scanSync(path.join(home, ".resagent", "reports"))]
        expect(reports).toHaveLength(1)
        const report = yield* Effect.promise(() =>
          Bun.file(path.join(home, ".resagent", "reports", reports[0]!)).text(),
        )
        expect(report).toContain("Verified conclusion.")
        expect(report).toContain("- Profile: `balanced`")
        expect(report).not.toContain(canary)
      }),
    90_000,
  )
})
