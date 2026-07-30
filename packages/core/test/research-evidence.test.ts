import { describe, expect, test } from "bun:test"
import { ResearchEvidence } from "@opencode-ai/core/research-evidence"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { DateTime } from "effect"

const time = { created: DateTime.makeUnsafe(0), completed: DateTime.makeUnsafe(0) }

const call = (
  id: string,
  name: string,
  state: {
    input?: Record<string, unknown>
    structured?: Record<string, unknown>
    content?: Array<{ type: "text"; text: string }>
  },
) =>
  SessionMessage.AssistantTool.make({
    type: "tool",
    id,
    name,
    state: {
      status: "completed",
      input: state.input ?? {},
      structured: state.structured ?? {},
      content: state.content ?? [],
    },
    time,
  })

const message = (content: SessionMessage.AssistantContent[]) =>
  SessionMessage.Assistant.make({
    id: SessionMessage.ID.make("msg_collect"),
    type: "assistant",
    agent: "build",
    model: { providerID: "p" as never, id: "m" as never },
    content,
    finish: "stop",
    time,
  })

describe("ResearchEvidence.harvest", () => {
  test("maps each retrieval tool onto its source kind", () => {
    const harvested = ResearchEvidence.harvest(
      message([
        call("c1", "webfetch", { input: { url: "https://example.test/a" }, structured: { output: "Page body" } }),
        call("c2", "websearch", { input: { query: "throughput" }, structured: { text: "Result list" } }),
        call("c3", "read", { input: { path: "src/a.ts" }, structured: { content: "file body" } }),
        call("c4", "remote_run", {
          input: { command: "uname -a" },
          structured: { command: "uname -a", results: [{ host: "lab-a", status: "ok", exit: 0, stdout: "Linux" }] },
        }),
      ]),
    )
    expect(harvested.map((item) => item.source)).toEqual([
      { kind: "web", url: "https://example.test/a" },
      { kind: "search", query: "throughput" },
      { kind: "file", path: "src/a.ts" },
      { kind: "remote", alias: "lab-a", command: "uname -a", exit: 0 },
    ])
    expect(harvested.every((item) => item.digest.length === 64)).toBeTrue()
  })

  test("splits one remote call into a row per host and folds the status into the digest", () => {
    const harvested = ResearchEvidence.harvest(
      message([
        call("c1", "remote_run", {
          structured: {
            command: "df -h",
            results: [
              { host: "lab-a", status: "ok", exit: 0, stdout: "50%" },
              { host: "lab-b", status: "failed", exit: 1, stdout: "50%", stderr: "no such file" },
            ],
          },
        }),
      ]),
    )
    expect(harvested).toHaveLength(2)
    expect(harvested[0]?.excerpt).toBe("[lab-a] ok (exit 0)\n50%")
    expect(harvested[1]?.excerpt).toBe("[lab-b] failed (exit 1)\n50%\nstderr:\nno such file")
    // Same stdout, different exit code, so the digests must differ.
    expect(harvested[0]?.digest).not.toBe(harvested[1]?.digest)
  })

  test("ignores tool calls that retrieve nothing citable", () => {
    expect(
      ResearchEvidence.harvest(
        message([
          call("c1", "grep", { input: { pattern: "x" }, content: [{ type: "text", text: "a.ts:1" }] }),
          call("c2", "glob", { input: { pattern: "*.ts" } }),
          call("c3", "read", { input: { path: "empty.ts" }, structured: { content: "   " } }),
          call("c4", "webfetch", { structured: { output: "body without a url" } }),
        ]),
      ),
    ).toEqual([])
  })

  test("marks an over-long excerpt as truncated while digesting the whole body", () => {
    const body = "x".repeat(ResearchEvidence.MAX_EXCERPT_CHARACTERS + 100)
    const harvested = ResearchEvidence.harvest(
      message([call("c1", "webfetch", { input: { url: "https://example.test" }, structured: { output: body } })]),
    )
    expect(harvested[0]?.excerpt).toHaveLength(ResearchEvidence.MAX_EXCERPT_CHARACTERS)
    expect(harvested[0]?.truncated).toBeTrue()
    expect(harvested[0]?.digest).not.toBe(
      ResearchEvidence.harvest(
        message([
          call("c1", "webfetch", {
            input: { url: "https://example.test" },
            structured: { output: body.slice(0, ResearchEvidence.MAX_EXCERPT_CHARACTERS) },
          }),
        ]),
      )[0]?.digest,
    )
  })
})

describe("ResearchEvidence.key", () => {
  test("identifies a candidate by its call and its source, not by its content", () => {
    expect(ResearchEvidence.key({ toolCallID: "c1", source: { kind: "file", path: ".\\src\\a.ts" } })).toBe(
      ResearchEvidence.key({ toolCallID: "c1", source: { kind: "file", path: "src/a.ts" } }),
    )
    expect(ResearchEvidence.key({ toolCallID: "c1", source: { kind: "search", query: " Throughput " } })).toBe(
      ResearchEvidence.key({ toolCallID: "c1", source: { kind: "search", query: "throughput" } }),
    )
    expect(ResearchEvidence.key({ toolCallID: "c1", source: { kind: "web", url: "https://a.test" } })).not.toBe(
      ResearchEvidence.key({ toolCallID: "c2", source: { kind: "web", url: "https://a.test" } }),
    )
  })
})

describe("ResearchEvidence.catalog", () => {
  const stored = (id: string, source: ResearchEvidence.Source, excerpt: string): ResearchEvidence.Evidence => ({
    id,
    stage: "collect",
    sessionID: "ses_x" as never,
    messageID: SessionMessage.ID.make("msg_collect"),
    toolCallID: "c1",
    tool: "webfetch",
    source,
    excerpt,
    digest: "d".repeat(64),
    truncated: false,
  })

  test("previews each row and marks the rows that continue", () => {
    const rendered = ResearchEvidence.catalog(
      [
        stored("ev_a", { kind: "web", url: "https://a.test", title: "A" }, "short body"),
        stored("ev_b", { kind: "remote", alias: "lab-a", command: "df -h", exit: 0 }, "y".repeat(400)),
      ],
      20,
    )
    expect(rendered).toContain("- `ev_a` (web) A <https://a.test>\n  short body")
    expect(rendered).toContain("- `ev_b` (remote) lab-a$ df -h (exit 0)")
    expect(rendered).toContain(`  ${"y".repeat(20)} …`)
  })
})

describe("ResearchEvidence.resolve", () => {
  test("reports which claimed sources were never actually retrieved", () => {
    const collected: ResearchEvidence.Evidence[] = [
      {
        id: "ev_a",
        stage: "collect",
        sessionID: "ses_x" as never,
        messageID: SessionMessage.ID.make("msg_collect"),
        toolCallID: "c1",
        tool: "webfetch",
        source: { kind: "web", url: "https://a.test" },
        excerpt: "body",
        digest: "d".repeat(64),
        truncated: false,
      },
    ]
    expect(
      ResearchEvidence.resolve(collected, [
        { kind: "web", url: "https://a.test" },
        { kind: "file", path: "src/a.ts" },
      ]),
    ).toEqual({ matched: ["ev_a"], unmatched: [{ kind: "file", path: "src/a.ts" }] })
  })
})
