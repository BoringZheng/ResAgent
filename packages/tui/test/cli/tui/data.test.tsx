/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { Event, GlobalEvent } from "@opencode-ai/sdk/v2"
import { onMount } from "solid-js"
import { ProjectProvider } from "../../../src/context/project"
import { SDKProvider } from "../../../src/context/sdk"
import { DataProvider, useData } from "../../../src/context/data"
import { createEventSource, createFetch, directory, json } from "../../fixture/tui-sdk"
import { TestTuiContexts } from "../../fixture/tui-environment"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function global(payload: Event): GlobalEvent {
  return { directory, project: "proj_test", payload }
}

function emitEvent(events: ReturnType<typeof createEventSource>, payload: Event) {
  events.emit(global(payload))
}

test("refreshes resources into reactive getters", async () => {
  const events = createEventSource()
  const location = {
    directory,
    project: { id: "proj_test", directory },
  }
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/ses_test")
      return json({
        data: {
          id: "ses_test",
          projectID: "proj_test",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated: 0 },
          title: "Test session",
          location: { directory },
        },
      })
    if (url.pathname === "/api/agent")
      return json({
        location,
        data: [{ id: "build", request: { headers: {}, body: {} }, mode: "primary", hidden: false, permissions: [] }],
      })
    return undefined
  }, events)
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    data = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    expect(data.location.default()).toEqual({ directory })
    expect(data.session.get("ses_test")).toBeUndefined()
    expect(data.location.agent.list(location)).toBeUndefined()

    await data.session.refresh("ses_test")
    await data.location.agent.refresh()

    expect(data.session.get("ses_test")?.title).toBe("Test session")
    expect(data.location.default()).toEqual({ directory, workspaceID: undefined })
    expect(data.location.agent.list(location)?.map((agent) => agent.id)).toEqual(["build"])
  } finally {
    app.renderer.destroy()
  }
})

test("refreshes integrations after integration updates", async () => {
  const events = createEventSource()
  const requests = { integration: 0, model: 0, provider: 0 }
  const calls = createFetch((url) => {
    if (url.pathname === "/api/model") {
      requests.model++
      return json({ location: { directory, project: { id: "proj_test", directory } }, data: [] })
    }
    if (url.pathname === "/api/provider") {
      requests.provider++
      return json({ location: { directory, project: { id: "proj_test", directory } }, data: [] })
    }
    if (url.pathname !== "/api/integration") return
    requests.integration++
    return json({
      location: { directory, project: { id: "proj_test", directory } },
      data:
        requests.integration === 1
          ? []
          : [
              {
                id: "openai",
                name: "OpenAI",
                methods: [{ type: "key" }],
              },
            ],
    })
  }, events)
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    data = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    await wait(() => data.location.integration.list() !== undefined)
    expect(data.location.integration.list()).toEqual([])
    const before = { ...requests }

    emitEvent(events, { id: "evt_integration", type: "integration.updated", properties: {} })
    await wait(() => data.location.integration.list()?.length === 1)
    await wait(() => requests.model > before.model && requests.provider > before.provider)
    expect(data.location.integration.list()?.[0]).toMatchObject({ id: "openai", name: "OpenAI" })
  } finally {
    app.renderer.destroy()
  }
})

test("refreshes effective catalog data after catalog updates", async () => {
  const events = createEventSource()
  const requests = { model: 0, provider: 0 }
  const calls = createFetch((url) => {
    if (url.pathname === "/api/model") {
      requests.model++
      return json({ location: { directory, project: { id: "proj_test", directory } }, data: [] })
    }
    if (url.pathname === "/api/provider") {
      requests.provider++
      return json({ location: { directory, project: { id: "proj_test", directory } }, data: [] })
    }
  }, events)

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <DataProvider>
            <box />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => requests.model > 0 && requests.provider > 0)
    const before = { ...requests }
    emitEvent(events, { id: "evt_catalog", type: "catalog.updated", properties: {} })
    await wait(() => requests.model > before.model && requests.provider > before.provider)
  } finally {
    app.renderer.destroy()
  }
})

test("refreshes references after updates", async () => {
  const events = createEventSource()
  let requests = 0
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/reference") return
    requests++
    return json({
      location: { directory, project: { id: "proj_test", directory } },
      data: requests === 1 ? [] : [{ name: "docs", path: "/docs", source: { type: "local", path: "/docs" } }],
    })
  }, events)
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    data = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    await wait(() => requests === 1)
    emitEvent(events, { id: "evt_reference_1", type: "reference.updated", properties: {} })
    await wait(() => data.location.reference.list()?.length === 1)
    expect(data.location.reference.list()?.[0]?.name).toBe("docs")
  } finally {
    app.renderer.destroy()
  }
})

test("settles pending tools when a live failure arrives", async () => {
  const events = createEventSource()
  const calls = createFetch(undefined, events)
  let sync!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    sync = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    emitEvent(events, {
      id: "evt_agent_1",
      type: "session.next.agent.switched",
      properties: { sessionID: "session-1", messageID: "msg_agent_1", timestamp: 0, agent: "build" },
    })
    emitEvent(events, {
      id: "evt_model_1",
      type: "session.next.model.switched",
      properties: {
        sessionID: "session-1",
        messageID: "msg_model_1",
        timestamp: 0,
        model: { id: "model-1", providerID: "provider-1" },
      },
    })
    emitEvent(events, {
      id: "evt_step_started_1",
      type: "session.next.step.started",
      properties: {
        sessionID: "session-1",
        assistantMessageID: "msg_explicit_assistant_9",
        timestamp: 1,
        agent: "build",
        model: { id: "model-1", providerID: "provider-1" },
      },
    })
    emitEvent(events, {
      id: "evt_input_1",
      type: "session.next.tool.input.started",
      properties: {
        sessionID: "session-1",
        assistantMessageID: "msg_explicit_assistant_9",
        timestamp: 2,
        callID: "call-1",
        name: "bash",
      },
    })
    emitEvent(events, {
      id: "evt_called_1",
      type: "session.next.tool.called",
      properties: {
        sessionID: "session-1",
        timestamp: 2,
        assistantMessageID: "msg_explicit_assistant_9",
        callID: "call-1",
        tool: "bash",
        input: {},
        provider: { executed: false, metadata: { fake: { call: true } } },
      },
    })
    emitEvent(events, {
      id: "evt_failed_1",
      type: "session.next.tool.failed",
      properties: {
        sessionID: "session-1",
        timestamp: 3,
        assistantMessageID: "msg_explicit_assistant_9",
        callID: "call-1",
        error: { type: "unknown", message: "aborted" },
        provider: { executed: false, metadata: { fake: { result: true } } },
      },
    })

    await wait(() => {
      const assistant = sync.session.message.list("session-1")?.[0]
      return (
        assistant?.type === "assistant" &&
        assistant.content[0]?.type === "tool" &&
        assistant.content[0].state.status === "error"
      )
    })

    const assistant = sync.session.message.list("session-1")?.[0]
    expect(assistant?.type).toBe("assistant")
    if (assistant?.type !== "assistant") return
    expect(assistant.id).toBe("msg_explicit_assistant_9")
    const tool = assistant.content[0]
    expect(tool?.type).toBe("tool")
    if (tool?.type !== "tool") return
    expect(tool.state.status).toBe("error")
    if (tool.state.status !== "error") return
    expect(tool.state.error).toEqual({ type: "unknown", message: "aborted" })
    expect(tool.state.input).toEqual({})
    expect(tool.state.structured).toEqual({})
    expect(tool.state.content).toEqual([])
    expect(tool.provider).toEqual({
      executed: false,
      metadata: { fake: { call: true } },
      resultMetadata: { fake: { result: true } },
    })
    expect((sync.session.message.list("session-1") ?? []).map((message) => message.type)).toEqual([
      "assistant",
      "model-switched",
      "agent-switched",
    ])
  } finally {
    app.renderer.destroy()
  }
})

test("renders admitted prompts only after they become model-visible", async () => {
  const events = createEventSource()
  const calls = createFetch(undefined, events)
  let sync!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    sync = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    emitEvent(events, {
      id: "evt_admitted_1",
      type: "session.next.prompt.admitted",
      properties: {
        sessionID: "session-1",
        messageID: "msg_user_1",
        timestamp: 0,
        prompt: { text: "hello" },
        delivery: "steer",
      },
    })
    expect(sync.session.message.list("session-1") ?? []).toEqual([])

    emitEvent(events, {
      id: "evt_prompted_1",
      type: "session.next.prompted",
      properties: {
        sessionID: "session-1",
        messageID: "msg_user_1",
        timestamp: 0,
        prompt: { text: "hello" },
        delivery: "steer",
      },
    })

    await wait(() => sync.session.message.list("session-1")?.length === 1)
    const message = sync.session.message.list("session-1")?.[0]
    expect(message?.type).toBe("user")
    if (message?.type !== "user") return
    expect(message).toMatchObject({ id: "msg_user_1", text: "hello" })
  } finally {
    app.renderer.destroy()
  }
})

test("projects live context updates with their message ID", async () => {
  const events = createEventSource()
  const calls = createFetch(undefined, events)
  let sync!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    sync = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    emitEvent(events, {
      id: "evt_context_1",
      type: "session.next.context.updated",
      properties: {
        sessionID: "session-1",
        messageID: "msg_context_1",
        timestamp: 1,
        text: "Updated context",
      },
    })

    await wait(() => sync.session.message.list("session-1")?.length === 1)
    expect(sync.session.message.list("session-1")?.[0]).toMatchObject({
      id: "msg_context_1",
      type: "system",
      text: "Updated context",
    })
  } finally {
    app.renderer.destroy()
  }
})

test("hydrates research state across durable history pages", async () => {
  const events = createEventSource()
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/session/ses_research/history") return
    const after = Number(url.searchParams.get("after") ?? "0")
    if (after === 0)
      return json({
        data: [
          {
            id: "evt_research_1",
            type: "session.next.research.started",
            durable: { aggregateID: "ses_research", seq: 1, version: 1 },
            data: {
              timestamp: 1,
              sessionID: "ses_research",
              runID: "run_research",
              profile: "balanced",
              question: "What changed?",
            },
          },
          {
            id: "evt_research_2",
            type: "session.next.research.stage.started",
            durable: { aggregateID: "ses_research", seq: 2, version: 1 },
            data: {
              timestamp: 2,
              sessionID: "ses_research",
              runID: "run_research",
              stage: "plan",
              role: "planner",
              route: ["openai/gpt-test", "anthropic/claude-test"],
            },
          },
        ],
        hasMore: true,
      })
    if (after === 2)
      return json({
        data: [
          {
            id: "evt_research_3",
            type: "session.next.research.provider.attempted",
            durable: { aggregateID: "ses_research", seq: 3, version: 1 },
            data: {
              timestamp: 3,
              sessionID: "ses_research",
              runID: "run_research",
              stage: "plan",
              role: "planner",
              turnID: "turn_research",
              entry: "openai/gpt-test",
              attempt: 1,
            },
          },
        ],
        hasMore: false,
      })
  }, events)
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    data = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    await data.session.research.refresh("ses_research")
    expect(JSON.parse(JSON.stringify(data.session.research.get("ses_research")))).toMatchObject({
      id: "run_research",
      status: "active",
      stages: [
        {
          stage: "plan",
          route: ["openai/gpt-test", "anthropic/claude-test"],
          attempts: [{ entry: "openai/gpt-test", status: "active" }],
        },
      ],
    })
  } finally {
    app.renderer.destroy()
  }
})

test("merges live research events that arrive during reconnect hydration", async () => {
  const events = createEventSource()
  let resolveHistory!: (response: Response) => void
  const history = new Promise<Response>((resolve) => {
    resolveHistory = resolve
  })
  const requests = { history: 0, research: 0 }
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/ses_reconnect/research") {
      requests.research++
      return json({ data: { runID: "run_unexpected", reportPath: "unexpected.md" } })
    }
    if (url.pathname !== "/api/session/ses_reconnect/history") return
    requests.history++
    return history
  }, events)
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    data = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    const refresh = data.session.research.refresh("ses_reconnect")
    await wait(() => requests.history === 1)
    const attempted = {
      id: "evt_reconnect_attempt",
      type: "session.next.research.provider.attempted",
      properties: {
        timestamp: 3,
        sessionID: "ses_reconnect",
        runID: "run_reconnect",
        stage: "plan",
        role: "planner",
        turnID: "turn_reconnect",
        entry: "primary/model",
        attempt: 1,
      },
      durable: { aggregateID: "ses_reconnect", seq: 3, version: 1 },
    } as Event
    emitEvent(events, attempted)
    resolveHistory(
      json({
        data: [
          {
            id: "evt_reconnect_started",
            type: "session.next.research.started",
            durable: { aggregateID: "ses_reconnect", seq: 1, version: 1 },
            data: {
              timestamp: 1,
              sessionID: "ses_reconnect",
              runID: "run_reconnect",
              profile: "balanced",
              question: "Reconnect safely",
            },
          },
          {
            id: "evt_reconnect_stage",
            type: "session.next.research.stage.started",
            durable: { aggregateID: "ses_reconnect", seq: 2, version: 1 },
            data: {
              timestamp: 2,
              sessionID: "ses_reconnect",
              runID: "run_reconnect",
              stage: "plan",
              role: "planner",
              route: ["primary/model", "backup/model"],
            },
          },
        ],
        hasMore: false,
      }),
    )
    await refresh

    expect(JSON.parse(JSON.stringify(data.session.research.get("ses_reconnect")?.stages[0]?.attempts))).toMatchObject([
      { entry: "primary/model", attempt: 1, status: "active" },
    ])
    emitEvent(events, attempted)
    await wait(() => data.session.research.get("ses_reconnect")?.stages[0]?.attempts.length === 1)
    expect(data.session.research.get("ses_reconnect")?.stages[0]?.attempts).toHaveLength(1)
    expect(requests).toEqual({ history: 1, research: 0 })
  } finally {
    app.renderer.destroy()
  }
})
