/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { ProjectProvider } from "../../src/context/project"
import { SDKProvider } from "../../src/context/sdk"
import { DataProvider, useData } from "../../src/context/data"
import { RemoteSidebar } from "../../src/feature-plugins/sidebar/remote"
import { ResearchSidebar } from "../../src/feature-plugins/sidebar/research"
import { RemoteRunResultView } from "../../src/routes/session"
import { collapseToolOutput } from "../../src/util/collapse-tool-output"
import { createEventSource, createFetch, directory, json } from "../fixture/tui-sdk"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiPluginApi } from "../fixture/tui-plugin"

async function wait(fn: () => boolean, timeout = 2_000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function lines(frame: string) {
  return frame
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
}

async function renderSidebars(width: number, height: number) {
  const events = createEventSource()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/provider")
      return json({
        location: { directory, project: { id: "proj_test", directory } },
        data: [{ id: "primary", name: "Primary", integrationID: "primary" }],
      })
    if (url.pathname !== "/api/session/ses_layout/history") return
    return json({
      data: researchHistory(),
      hasMore: false,
    })
  }, events)
  const api = createTuiPluginApi()
  api.kv.set("resagent.remote.targets.ses_layout", ["lab-primary-with-a-long-alias", "lab-backup-with-a-long-alias"])
  let ready = false

  function Harness() {
    const data = useData()
    onMount(() => {
      void data.session.research.refresh("ses_layout").then(() => {
        ready = true
      })
    })
    return (
      <box width="100%" height="100%" flexDirection="row">
        <box flexGrow={1}>
          <text>Session transcript</text>
        </box>
        <box width={Math.min(42, width - 20)} paddingLeft={1}>
          <ResearchSidebar api={api} session_id="ses_layout" />
          <RemoteSidebar api={api} session_id="ses_layout" />
        </box>
      </box>
    )
  }

  const app = await testRender(
    () => (
      <TestTuiContexts>
        <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
          <ProjectProvider>
            <DataProvider>
              <Harness />
            </DataProvider>
          </ProjectProvider>
        </SDKProvider>
      </TestTuiContexts>
    ),
    { width, height },
  )
  try {
    await wait(() => ready)
    await app.renderOnce()
    await app.renderOnce()
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}

function researchHistory() {
  const base = { sessionID: "ses_layout", runID: "run_layout" }
  const stages = [
    ["plan", "planner"],
    ["collect", "collector"],
    ["analyze", "analyst"],
    ["verify", "verifier"],
    ["report", "writer"],
  ] as const
  const started = {
    id: "evt_layout_1",
    type: "session.next.research.started",
    durable: { aggregateID: "ses_layout", seq: 1, version: 1 },
    data: { ...base, timestamp: 1, profile: "balanced", question: "Inspect the release" },
  }
  const stageEvents = stages.flatMap(([stage, role], index) => {
    const seq = index * 2 + 2
    const start = {
      id: `evt_layout_${seq}`,
      type: "session.next.research.stage.started",
      durable: { aggregateID: "ses_layout", seq, version: 1 },
      data: {
        ...base,
        timestamp: seq,
        stage,
        role,
        route: ["primary/model-with-a-long-name", "backup/model-with-a-long-name"],
      },
    }
    if (stage === "report") return [start]
    return [
      start,
      {
        id: `evt_layout_${seq + 1}`,
        type: "session.next.research.stage.completed",
        durable: { aggregateID: "ses_layout", seq: seq + 1, version: 1 },
        data: { ...base, timestamp: seq + 1, stage, messageID: `msg_${stage}` },
      },
    ]
  })
  return [
    started,
    ...stageEvents,
    {
      id: "evt_layout_attempt",
      type: "session.next.research.provider.attempted",
      durable: { aggregateID: "ses_layout", seq: 11, version: 1 },
      data: {
        ...base,
        timestamp: 11,
        stage: "report",
        role: "writer",
        turnID: "turn_layout",
        entry: "backup/model-with-a-long-name",
        attempt: 2,
      },
    },
  ]
}

describe("ResAgent terminal layouts", () => {
  for (const [width, height] of [
    [80, 24],
    [120, 40],
  ] as const) {
    test(`renders research and remote sidebars at ${width}x${height}`, async () => {
      const frame = await renderSidebars(width, height)
      const output = lines(frame)

      expect(frame).toContain("Research · balanced")
      expect(frame).toContain("Plan")
      expect(frame).toContain("Report")
      expect(frame).toContain("backup/model-with-a-long-name")
      expect(frame).toContain("Remote Targets")
      expect(frame).toContain("lab-primary-with-a-long-alias")
      expect(output.every((line) => line.length <= width)).toBe(true)
    })

    test(`renders partial remote results at ${width}x${height}`, async () => {
      const result = {
        command: "printf a very long diagnostic command with bounded output",
        results: [
          {
            host: "lab-primary-with-a-long-alias",
            status: "ok" as const,
            exit: 0,
            duration_ms: 125,
            stdout: "primary output\n".repeat(10),
            stderr: "",
            truncated: false,
          },
          {
            host: "lab-backup-with-a-long-alias",
            status: "failed" as const,
            exit: 9,
            duration_ms: 250,
            stdout: "",
            stderr: "backup failed\n".repeat(10),
            truncated: true,
          },
          {
            host: "lab-timeout",
            status: "timeout" as const,
            duration_ms: 5_000,
            stdout: "",
            stderr: "Command exceeded timeout.",
            truncated: false,
          },
        ],
      }
      const output = result.results.flatMap((item) => [
        ...(item.stdout.trim() ? [`[${item.host}] stdout\n${item.stdout.trim()}`] : []),
        ...(item.stderr.trim() ? [`[${item.host}] stderr\n${item.stderr.trim()}`] : []),
      ])
      const collapsed = collapseToolOutput(output.join("\n\n"), 12, 12 * Math.max(20, width - 6))
      const color = RGBA.fromInts(200, 200, 200)
      const app = await testRender(
        () => (
          <box width="100%" height="100%">
            <RemoteRunResultView
              result={result}
              output={output}
              collapsed={collapsed}
              expanded={false}
              theme={{ text: color, textMuted: color, success: color, warning: color, error: color }}
            />
          </box>
        ),
        { width, height },
      )
      try {
        await app.renderOnce()
        await app.renderOnce()
        const frame = app.captureCharFrame()

        expect(frame).toContain("lab-primary-with-a-long-alias")
        expect(frame).toContain("lab-backup-with-a-long-alias")
        expect(frame).toContain("lab-timeout")
        expect(frame).toContain("truncated")
        expect(frame).toContain("Click to expand")
        expect(lines(frame).every((line) => line.length <= width)).toBe(true)
      } finally {
        app.renderer.destroy()
      }
    })
  }
})
