import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { FileSystem, Integration, Permission, Project, Reference, Session, Workspace } from "../src"
import { EventManifest } from "../src/event-manifest"
import { IdeEvent } from "../src/ide-event"
import { SessionEvent } from "../src/session-event"
import { SessionTodo } from "../src/session-todo"
import { SessionV1 } from "../src/session-v1"
import { WorkspaceEvent } from "../src/workspace-event"

describe("public event manifest", () => {
  test("owns the complete public event surface", () => {
    expect(EventManifest.ServerDefinitions.length).toBe(65)
    expect(EventManifest.Definitions.length).toBe(95)
    expect(SessionV1.Event.Definitions).toEqual([
      SessionV1.Event.Created,
      SessionV1.Event.Updated,
      SessionV1.Event.Deleted,
      SessionV1.Event.MessageUpdated,
      SessionV1.Event.MessageRemoved,
      SessionV1.Event.PartUpdated,
      SessionV1.Event.PartRemoved,
      SessionV1.Event.PartDelta,
      SessionV1.Event.Diff,
      SessionV1.Event.Error,
    ])
    expect(EventManifest.Latest.size).toBe(95)
    expect(EventManifest.Durable.size).toBe(42)
  })

  test("uses canonical definitions for current public events", () => {
    expect(Session.Event).toBe(SessionEvent)
    expect(Session.Event.Definitions).toBe(SessionEvent.Definitions)
    expect(Workspace.Event).toBe(WorkspaceEvent)
    expect(Workspace.Event.Definitions).toBe(WorkspaceEvent.Definitions)
    expect(EventManifest.Latest.get("session.next.step.ended")).toBe(SessionEvent.Step.Ended)
    expect(EventManifest.Latest.get("session.next.research.started")).toBe(SessionEvent.Research.Started)
    expect(EventManifest.Latest.get("session.next.research.stage.started")).toBe(SessionEvent.Research.StageStarted)
    expect(EventManifest.Latest.get("session.next.research.provider.attempted")).toBe(
      SessionEvent.Research.ProviderAttempted,
    )
    expect(EventManifest.Latest.get("session.next.research.provider.attempt.settled")).toBe(
      SessionEvent.Research.ProviderAttemptSettled,
    )
    expect(EventManifest.Latest.get("session.next.research.stage.completed")).toBe(SessionEvent.Research.StageCompleted)
    expect(EventManifest.Latest.get("session.next.research.completed")).toBe(SessionEvent.Research.Completed)
    expect(EventManifest.Latest.get("session.next.research.failed")).toBe(SessionEvent.Research.Failed)
    expect(EventManifest.Latest.get("todo.updated")).toBe(SessionTodo.Event.Updated)
    expect(EventManifest.Latest.get("project.updated")).toBe(Project.Event.Updated)
    expect(Project.Event.Definitions).toEqual([Project.Event.Updated])
    expect(FileSystem.Event.Definitions).toEqual([FileSystem.Event.Edited])
    expect(Integration.Event.Definitions).toEqual([Integration.Event.Updated, Integration.Event.ConnectionUpdated])
    expect(Permission.Event.Definitions).toEqual([Permission.Event.Asked, Permission.Event.Replied])
    expect(Reference.Event.Definitions).toEqual([Reference.Event.Updated])
    expect(EventManifest.Latest.has("ide.installed")).toBe(false)
    expect(IdeEvent.Definitions).toEqual([IdeEvent.Installed])
    expect(EventManifest.Definitions.slice(50, 53)).toEqual([
      SessionV1.Event.PartDelta,
      SessionV1.Event.Diff,
      SessionV1.Event.Error,
    ])
    expect(EventManifest.Durable.has("session.next.step.ended.1")).toBe(false)
    expect(EventManifest.Durable.get("session.next.step.ended.2")).toBe(SessionEvent.Step.Ended)
  })
})

describe("research event contracts", () => {
  test("rejects malformed identifiers, routes, and non-positive attempts", () => {
    const decodeRunID = Schema.decodeUnknownSync(SessionEvent.Research.RunID)
    const decodeTurnID = Schema.decodeUnknownSync(SessionEvent.Research.TurnID)
    const decodeRoute = Schema.decodeUnknownSync(SessionEvent.Research.RouteEntry)
    const decodeAttempt = Schema.decodeUnknownSync(SessionEvent.Research.ProviderAttempted.data.fields.attempt)

    expect(() => decodeRunID("run_bad-id")).toThrow()
    expect(() => decodeTurnID("turn_bad id")).toThrow()
    expect(() => decodeRoute("openai/gpt 5")).toThrow()
    expect(() => decodeRoute("openai/\ngpt-5")).toThrow()
    expect(() => decodeAttempt(0)).toThrow()
    expect(decodeRunID("run_ABC123")).toBe("run_ABC123")
    expect(decodeTurnID("turn_ABC123")).toBe("turn_ABC123")
    expect(decodeRoute("openai/gpt-5")).toBe("openai/gpt-5")
    expect(decodeAttempt(1)).toBe(1)
  })
})
