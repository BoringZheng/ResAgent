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
        // A stage finishes only by settling its own submission tool, and the session replays its
        // whole history on every request, so each reply is matched on the stage prompt that opened
        // the turn rather than queued positionally.
        const atStage = (stage: string) => (hit: { body: unknown }) =>
          JSON.stringify(hit.body).includes(`[ResAgent research stage: ${stage}]`)
        yield* llm.toolMatch(atStage("plan"), "research_plan", {
          stage: "plan",
          subquestions: [{ id: "sq1", question: "What is the result?" }],
          requirements: [
            {
              id: "r1",
              subquestion_id: "sq1",
              description: "A stated result",
              source_kinds: ["file"],
              acceptance: "A document stating the result",
            },
          ],
        })
        yield* llm.toolMatch(atStage("collect"), "research_collect", {
          stage: "collect",
          summary: "Evidence",
          coverage: [{ requirement_id: "r1", status: "unmet", sources: [], note: "No source was reachable" }],
        })
        yield* llm.toolMatch(atStage("analyze"), "research_analyze", {
          stage: "analyze",
          findings: [{ claim: "Nothing supports a result yet", evidence_ids: [], confidence: "low" }],
          conflicts: [],
          gaps: [{ requirement_id: "r1", what_is_missing: "Any source", suggested_action: "Read a document" }],
        })
        yield* llm.toolMatch(atStage("verify"), "research_verify", {
          stage: "verify",
          assessments: [
            {
              claim: "Nothing supports a result yet",
              verdict: "unsupported",
              rationale: "The run collected no evidence",
              evidence_ids: [],
            },
          ],
          gaps: [],
        })
        yield* llm.toolMatch(atStage("report"), "research_report", {
          stage: "report",
          markdown: "# Final report\n\nVerified conclusion.",
          citations: [],
          limitations: ["No source was reachable"],
        })
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
        expect(report).toContain("- `r1` (analyze): Any source → Read a document")
        expect(report).not.toContain(canary)
      }),
    90_000,
  )
})
