export * as SessionEvent from "./session-event"

import { Schema } from "effect"
import { optional } from "./schema"
import { Event } from "./event"
import { ProviderMetadata, ToolContent } from "./llm"
import { Delivery } from "./session-delivery"
import { Model } from "./model"
import { DateTimeUtcFromMillis, NonNegativeInt, PositiveInt, RelativePath } from "./schema"
import { FileAttachment, Prompt } from "./prompt"
import { SessionID } from "./session-id"
import { Location } from "./location"
import { SessionMessage } from "./session-message"
import { Revert } from "./revert"

export { FileAttachment }

export const Source = Schema.Struct({
  start: NonNegativeInt,
  end: NonNegativeInt,
  text: Schema.String,
}).annotate({
  identifier: "session.next.event.source",
})
export interface Source extends Schema.Schema.Type<typeof Source> {}

const Base = {
  timestamp: DateTimeUtcFromMillis,
  sessionID: SessionID,
}
const PromptFields = {
  ...Base,
  messageID: SessionMessage.ID,
  prompt: Prompt,
  delivery: Delivery,
}

const options = {
  durable: {
    aggregate: "sessionID",
    version: 1,
  },
} as const
const stepSettlementOptions = {
  durable: {
    aggregate: "sessionID",
    version: 2,
  },
} as const

export const UnknownError = SessionMessage.UnknownError
export type UnknownError = SessionMessage.UnknownError

export const AgentSwitched = Event.define({
  type: "session.next.agent.switched",
  ...options,
  schema: {
    ...Base,
    messageID: SessionMessage.ID,
    agent: Schema.String,
  },
})
export type AgentSwitched = typeof AgentSwitched.Type

export const ModelSwitched = Event.define({
  type: "session.next.model.switched",
  ...options,
  schema: {
    ...Base,
    messageID: SessionMessage.ID,
    model: Model.Ref,
  },
})
export type ModelSwitched = typeof ModelSwitched.Type

export const Moved = Event.define({
  type: "session.next.moved",
  ...options,
  schema: {
    ...Base,
    location: Location.Ref,
    subdirectory: RelativePath.pipe(optional),
  },
})
export type Moved = typeof Moved.Type

export const Prompted = Event.define({
  type: "session.next.prompted",
  ...options,
  schema: PromptFields,
})
export type Prompted = typeof Prompted.Type

export const PromptAdmitted = Event.define({
  type: "session.next.prompt.admitted",
  ...options,
  schema: PromptFields,
})
export type PromptAdmitted = typeof PromptAdmitted.Type

export const ContextUpdated = Event.define({
  type: "session.next.context.updated",
  ...options,
  schema: {
    ...Base,
    messageID: SessionMessage.ID,
    text: Schema.String,
  },
})
export type ContextUpdated = typeof ContextUpdated.Type

export const Synthetic = Event.define({
  type: "session.next.synthetic",
  ...options,
  schema: {
    ...Base,
    messageID: SessionMessage.ID,
    text: Schema.String,
  },
})
export type Synthetic = typeof Synthetic.Type

export namespace Shell {
  export const Started = Event.define({
    type: "session.next.shell.started",
    ...options,
    schema: {
      ...Base,
      messageID: SessionMessage.ID,
      callID: Schema.String,
      command: Schema.String,
    },
  })
  export type Started = typeof Started.Type

  export const Ended = Event.define({
    type: "session.next.shell.ended",
    ...options,
    schema: {
      ...Base,
      callID: Schema.String,
      output: Schema.String,
    },
  })
  export type Ended = typeof Ended.Type
}

export namespace Step {
  export const Started = Event.define({
    type: "session.next.step.started",
    ...options,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      agent: Schema.String,
      model: Model.Ref,
      snapshot: Schema.String.pipe(optional),
    },
  })
  export type Started = typeof Started.Type

  export const Ended = Event.define({
    type: "session.next.step.ended",
    ...stepSettlementOptions,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      finish: Schema.String,
      cost: Schema.Finite,
      tokens: Schema.Struct({
        input: Schema.Finite,
        output: Schema.Finite,
        reasoning: Schema.Finite,
        cache: Schema.Struct({
          read: Schema.Finite,
          write: Schema.Finite,
        }),
      }),
      snapshot: Schema.String.pipe(optional),
      files: Schema.Array(RelativePath).pipe(optional),
    },
  })
  export type Ended = typeof Ended.Type

  export const Failed = Event.define({
    type: "session.next.step.failed",
    ...stepSettlementOptions,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      error: UnknownError,
    },
  })
  export type Failed = typeof Failed.Type
}

export namespace Text {
  export const Started = Event.define({
    type: "session.next.text.started",
    ...options,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      textID: Schema.String,
    },
  })
  export type Started = typeof Started.Type

  // Stream fragments are live-only; Text.Ended is the replayable full-value boundary.
  export const Delta = Event.define({
    type: "session.next.text.delta",
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      textID: Schema.String,
      delta: Schema.String,
    },
  })
  export type Delta = typeof Delta.Type

  export const Ended = Event.define({
    type: "session.next.text.ended",
    ...options,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      textID: Schema.String,
      text: Schema.String,
    },
  })
  export type Ended = typeof Ended.Type
}

export namespace Reasoning {
  export const Started = Event.define({
    type: "session.next.reasoning.started",
    ...options,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      reasoningID: Schema.String,
      providerMetadata: ProviderMetadata.pipe(optional),
    },
  })
  export type Started = typeof Started.Type

  // Stream fragments are live-only; Reasoning.Ended is the replayable full-value boundary.
  export const Delta = Event.define({
    type: "session.next.reasoning.delta",
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      reasoningID: Schema.String,
      delta: Schema.String,
    },
  })
  export type Delta = typeof Delta.Type

  export const Ended = Event.define({
    type: "session.next.reasoning.ended",
    ...options,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      reasoningID: Schema.String,
      text: Schema.String,
      providerMetadata: ProviderMetadata.pipe(optional),
    },
  })
  export type Ended = typeof Ended.Type
}

export namespace Tool {
  const ToolBase = {
    ...Base,
    assistantMessageID: SessionMessage.ID,
    callID: Schema.String,
  }

  export namespace Input {
    export const Started = Event.define({
      type: "session.next.tool.input.started",
      ...options,
      schema: {
        ...ToolBase,
        name: Schema.String,
      },
    })
    export type Started = typeof Started.Type

    // Stream fragments are live-only; Input.Ended is the replayable raw-input boundary.
    export const Delta = Event.define({
      type: "session.next.tool.input.delta",
      schema: {
        ...ToolBase,
        delta: Schema.String,
      },
    })
    export type Delta = typeof Delta.Type

    export const Ended = Event.define({
      type: "session.next.tool.input.ended",
      ...options,
      schema: {
        ...ToolBase,
        text: Schema.String,
      },
    })
    export type Ended = typeof Ended.Type
  }

  export const Called = Event.define({
    type: "session.next.tool.called",
    ...options,
    schema: {
      ...ToolBase,
      tool: Schema.String,
      input: Schema.Record(Schema.String, Schema.Unknown),
      provider: Schema.Struct({
        executed: Schema.Boolean,
        metadata: ProviderMetadata.pipe(optional),
      }),
    },
  })
  export type Called = typeof Called.Type

  /**
   * Replayable bounded running-tool state. Tools should checkpoint semantic
   * transitions or at a bounded cadence, not persist every stdout/stderr chunk.
   */
  export const Progress = Event.define({
    type: "session.next.tool.progress",
    ...options,
    schema: {
      ...ToolBase,
      structured: Schema.Record(Schema.String, Schema.Unknown),
      content: Schema.Array(ToolContent),
    },
  })
  export type Progress = typeof Progress.Type

  export const Success = Event.define({
    type: "session.next.tool.success",
    ...options,
    schema: {
      ...ToolBase,
      structured: Schema.Record(Schema.String, Schema.Unknown),
      content: Schema.Array(ToolContent),
      outputPaths: Schema.Array(Schema.String).pipe(optional),
      result: Schema.Unknown.pipe(optional),
      provider: Schema.Struct({
        executed: Schema.Boolean,
        metadata: ProviderMetadata.pipe(optional),
      }),
    },
  })
  export type Success = typeof Success.Type

  export const Failed = Event.define({
    type: "session.next.tool.failed",
    ...options,
    schema: {
      ...ToolBase,
      error: UnknownError,
      result: Schema.Unknown.pipe(optional),
      provider: Schema.Struct({
        executed: Schema.Boolean,
        metadata: ProviderMetadata.pipe(optional),
      }),
    },
  })
  export type Failed = typeof Failed.Type
}

export const RetryError = Schema.Struct({
  message: Schema.String,
  statusCode: Schema.Finite.pipe(optional),
  isRetryable: Schema.Boolean,
  responseHeaders: Schema.Record(Schema.String, Schema.String).pipe(optional),
  responseBody: Schema.String.pipe(optional),
  metadata: Schema.Record(Schema.String, Schema.String).pipe(optional),
}).annotate({
  identifier: "session.next.retry_error",
})
export interface RetryError extends Schema.Schema.Type<typeof RetryError> {}

export const Retried = Event.define({
  type: "session.next.retried",
  ...options,
  schema: {
    ...Base,
    attempt: Schema.Finite,
    error: RetryError,
  },
})
export type Retried = typeof Retried.Type

export namespace Compaction {
  export const Started = Event.define({
    type: "session.next.compaction.started",
    ...options,
    schema: {
      ...Base,
      messageID: SessionMessage.ID,
      reason: Schema.Union([Schema.Literal("auto"), Schema.Literal("manual")]),
    },
  })
  export type Started = typeof Started.Type

  export const Delta = Event.define({
    type: "session.next.compaction.delta",
    schema: {
      ...Base,
      messageID: SessionMessage.ID,
      text: Schema.String,
    },
  })
  export type Delta = typeof Delta.Type

  export const Ended = Event.define({
    type: "session.next.compaction.ended",
    ...options,
    schema: {
      ...Base,
      messageID: SessionMessage.ID,
      reason: Started.data.fields.reason,
      text: Schema.String,
      recent: Schema.String,
    },
  })
  export type Ended = typeof Ended.Type
}

export namespace RevertEvent {
  export const Staged = Event.define({
    type: "session.next.revert.staged",
    ...options,
    schema: { ...Base, revert: Revert.State },
  })
  export const Cleared = Event.define({ type: "session.next.revert.cleared", ...options, schema: Base })
  export const Committed = Event.define({
    type: "session.next.revert.committed",
    ...options,
    schema: { ...Base, messageID: SessionMessage.ID },
  })
}

export namespace Research {
  export const Stage = Schema.Literals(["plan", "collect", "analyze", "verify", "report"])
  export type Stage = typeof Stage.Type

  export const Role = Schema.Literals(["planner", "collector", "analyst", "verifier", "writer"])
  export type Role = typeof Role.Type
  export const RunID = Schema.String.check(Schema.isPattern(/^run_[A-Za-z0-9]+$/))
  export const TurnID = Schema.String.check(Schema.isPattern(/^turn_[A-Za-z0-9]+$/))
  export const Profile = Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/))
  export const RouteEntry = Schema.String.check(Schema.isPattern(/^[^\s/]+\/\S+$/))

  export const Started = Event.define({
    type: "session.next.research.started",
    ...options,
    schema: {
      ...Base,
      runID: RunID,
      profile: Profile,
      question: Schema.String,
    },
  })
  export type Started = typeof Started.Type

  export const StageStarted = Event.define({
    type: "session.next.research.stage.started",
    ...options,
    schema: {
      ...Base,
      runID: RunID,
      stage: Stage,
      role: Role,
      route: Schema.Array(RouteEntry),
    },
  })
  export type StageStarted = typeof StageStarted.Type

  export const ProviderAttempted = Event.define({
    type: "session.next.research.provider.attempted",
    ...options,
    schema: {
      ...Base,
      runID: RunID,
      stage: Stage,
      role: Role,
      turnID: TurnID,
      entry: RouteEntry,
      attempt: PositiveInt,
    },
  })
  export type ProviderAttempted = typeof ProviderAttempted.Type

  export const ProviderAttemptSettled = Event.define({
    type: "session.next.research.provider.attempt.settled",
    ...options,
    schema: {
      ...Base,
      runID: RunID,
      stage: Stage,
      role: Role,
      turnID: TurnID,
      entry: RouteEntry,
      attempt: PositiveInt,
      outcome: Schema.Literals(["succeeded", "retryable-failure", "terminal-failure"]),
      replaySafe: Schema.Boolean,
      messageID: SessionMessage.ID.pipe(optional),
    },
  })
  export type ProviderAttemptSettled = typeof ProviderAttemptSettled.Type

  export const StageCompleted = Event.define({
    type: "session.next.research.stage.completed",
    ...options,
    schema: {
      ...Base,
      runID: RunID,
      stage: Stage,
      messageID: SessionMessage.ID,
    },
  })
  export type StageCompleted = typeof StageCompleted.Type

  export const EvidenceID = Schema.String.check(Schema.isPattern(/^ev_[A-Za-z0-9]+$/))

  export const EvidenceSource = Schema.Union(
    [
      Schema.Struct({ kind: Schema.Literal("web"), url: Schema.String, title: Schema.String.pipe(optional) }),
      Schema.Struct({ kind: Schema.Literal("file"), path: Schema.String }),
      Schema.Struct({ kind: Schema.Literal("search"), query: Schema.String }),
      Schema.Struct({
        kind: Schema.Literal("remote"),
        alias: Schema.String,
        command: Schema.String,
        exit: Schema.Int.pipe(optional),
      }),
    ],
    { mode: "oneOf" },
  ).pipe(Schema.toTaggedUnion("kind"))
  export type EvidenceSource = typeof EvidenceSource.Type

  // Evidence is harvested from durable tool parts rather than declared by the model, so a
  // recorded row always identifies the exact tool call it came from.
  export const EvidenceRecorded = Event.define({
    type: "session.next.research.evidence.recorded",
    ...options,
    schema: {
      ...Base,
      runID: RunID,
      stage: Stage,
      evidenceID: EvidenceID,
      collectedSessionID: SessionID,
      messageID: SessionMessage.ID,
      toolCallID: Schema.String,
      tool: Schema.String,
      source: EvidenceSource,
      excerpt: Schema.String,
      digest: Schema.String,
      truncated: Schema.Boolean,
      supersedes: EvidenceID.pipe(optional),
    },
  })
  export type EvidenceRecorded = typeof EvidenceRecorded.Type

  // The plan is recorded separately from message history so later stages survive compaction.
  export const PlanRecorded = Event.define({
    type: "session.next.research.plan.recorded",
    ...options,
    schema: {
      ...Base,
      runID: RunID,
      messageID: SessionMessage.ID,
      plan: Schema.Record(Schema.String, Schema.Unknown),
    },
  })
  export type PlanRecorded = typeof PlanRecorded.Type

  // A completed stage is reopened, never restarted, so `StageStarted`'s once-per-stage rule keeps
  // its meaning and an event stream that predates this type folds exactly as it did before.
  export const StageReopened = Event.define({
    type: "session.next.research.stage.reopened",
    ...options,
    schema: {
      ...Base,
      runID: RunID,
      stage: Stage,
      round: PositiveInt,
      reason: Schema.String,
    },
  })
  export type StageReopened = typeof StageReopened.Type

  export const Completed = Event.define({
    type: "session.next.research.completed",
    ...options,
    schema: {
      ...Base,
      runID: RunID,
      reportPath: Schema.String.pipe(optional),
    },
  })
  export type Completed = typeof Completed.Type

  export const Failed = Event.define({
    type: "session.next.research.failed",
    ...options,
    schema: {
      ...Base,
      runID: RunID,
      message: Schema.String,
    },
  })
  export type Failed = typeof Failed.Type

  // A failed run is resumed, never restarted: the completed stages, the recorded plan, and the
  // evidence index all stand, so the run picks up at the stage that did not finish.
  export const Resumed = Event.define({
    type: "session.next.research.resumed",
    ...options,
    schema: {
      ...Base,
      runID: RunID,
      fromStage: Stage,
    },
  })
  export type Resumed = typeof Resumed.Type

  // Collection may be split across child sessions. The child does the gathering, but the parent's
  // stream is the run's only ledger: this event is what grants a child the collect stage's tools,
  // so setting `parentID` alone cannot buy a session research authority.
  export const SubcollectionStarted = Event.define({
    type: "session.next.research.subcollection.started",
    ...options,
    schema: {
      ...Base,
      runID: RunID,
      round: PositiveInt,
      childSessionID: SessionID,
      requirementIDs: Schema.Array(Schema.String),
    },
  })
  export type SubcollectionStarted = typeof SubcollectionStarted.Type

  // Settling withdraws the borrowed authority whether the child gathered anything or not.
  export const SubcollectionSettled = Event.define({
    type: "session.next.research.subcollection.settled",
    ...options,
    schema: {
      ...Base,
      runID: RunID,
      childSessionID: SessionID,
      outcome: Schema.Literals(["succeeded", "failed"]),
    },
  })
  export type SubcollectionSettled = typeof SubcollectionSettled.Type

  export const DurableDefinitions = Event.inventory(
    Started,
    StageStarted,
    ProviderAttempted,
    ProviderAttemptSettled,
    StageCompleted,
    EvidenceRecorded,
    PlanRecorded,
    StageReopened,
    Completed,
    Failed,
    Resumed,
    SubcollectionStarted,
    SubcollectionSettled,
  )
  export const Durable = Schema.Union(DurableDefinitions, { mode: "oneOf" }).pipe(Schema.toTaggedUnion("type"))
  export type DurableEvent = typeof Durable.Type
}

export const DurableDefinitions = Event.inventory(
  AgentSwitched,
  ModelSwitched,
  Moved,
  Prompted,
  PromptAdmitted,
  ContextUpdated,
  Synthetic,
  Shell.Started,
  Shell.Ended,
  Step.Started,
  Step.Ended,
  Step.Failed,
  Text.Started,
  Text.Ended,
  Tool.Input.Started,
  Tool.Input.Ended,
  Tool.Called,
  Tool.Progress,
  Tool.Success,
  Tool.Failed,
  Reasoning.Started,
  Reasoning.Ended,
  Retried,
  Compaction.Started,
  Compaction.Ended,
  RevertEvent.Staged,
  RevertEvent.Cleared,
  RevertEvent.Committed,
  ...Research.DurableDefinitions,
)

export const Definitions = Event.inventory(
  AgentSwitched,
  ModelSwitched,
  Moved,
  Prompted,
  PromptAdmitted,
  ContextUpdated,
  Synthetic,
  Shell.Started,
  Shell.Ended,
  Step.Started,
  Step.Ended,
  Step.Failed,
  Text.Started,
  Text.Delta,
  Text.Ended,
  Reasoning.Started,
  Reasoning.Delta,
  Reasoning.Ended,
  Tool.Input.Started,
  Tool.Input.Delta,
  Tool.Input.Ended,
  Tool.Called,
  Tool.Progress,
  Tool.Success,
  Tool.Failed,
  Retried,
  Compaction.Started,
  Compaction.Delta,
  Compaction.Ended,
  RevertEvent.Staged,
  RevertEvent.Cleared,
  RevertEvent.Committed,
  ...Research.DurableDefinitions,
)

export const Durable = Schema.Union(DurableDefinitions, { mode: "oneOf" })
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "SessionDurableEvent" })
export type DurableEvent = typeof Durable.Type

export const All = Schema.Union(Definitions, { mode: "oneOf" }).pipe(Schema.toTaggedUnion("type"))
export type Event = typeof All.Type
export type Type = Event["type"]
