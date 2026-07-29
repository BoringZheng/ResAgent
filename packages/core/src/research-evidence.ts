export * as ResearchEvidence from "./research-evidence"

import { SessionEvent } from "@opencode-ai/schema/session-event"
import { SessionMessage } from "./session/message"
import { SessionSchema } from "./session/schema"
import { Hash } from "./util/hash"

export const MAX_EXCERPT_CHARACTERS = 4_000
export const PREVIEW_CHARACTERS = 320

export type Source = SessionEvent.Research.EvidenceSource

/** The subset of a source that identifies it, shared with the collector-declared source refs. */
export type SourceRef =
  | { readonly kind: "web"; readonly url: string }
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "search"; readonly query: string }
  | { readonly kind: "remote"; readonly alias: string; readonly command: string }

export interface Evidence {
  readonly id: string
  readonly stage: SessionEvent.Research.Stage
  readonly sessionID: SessionSchema.ID
  readonly messageID: SessionMessage.ID
  readonly toolCallID: string
  readonly tool: string
  readonly source: Source
  readonly excerpt: string
  readonly digest: string
  readonly truncated: boolean
  readonly supersedes?: string
}

/** What a settled tool call yielded, before the run assigns it an identity. */
export interface Candidate {
  readonly toolCallID: string
  readonly tool: string
  readonly source: Source
  readonly excerpt: string
  readonly digest: string
  readonly truncated: boolean
}

export const createID = () => `ev_${crypto.randomUUID().replaceAll("-", "")}`

export function fromEvent(data: SessionEvent.Research.EvidenceRecorded["data"]): Evidence {
  return {
    id: data.evidenceID,
    stage: data.stage,
    sessionID: data.collectedSessionID,
    messageID: data.messageID,
    toolCallID: data.toolCallID,
    tool: data.tool,
    source: data.source,
    excerpt: data.excerpt,
    digest: data.digest,
    truncated: data.truncated,
    ...(data.supersedes === undefined ? {} : { supersedes: data.supersedes }),
  }
}

/**
 * Collect evidence from the durable tool parts of a settled turn. The model declares nothing here,
 * so it can neither forget to register a source nor claim one it never fetched. Navigation tools
 * (`glob`, `grep`) are deliberately excluded: file listings crowd out the substance they lead to.
 */
export function harvest(message: SessionMessage.Assistant): ReadonlyArray<Candidate> {
  return message.content.flatMap((part) =>
    part.type === "tool" && part.state.status === "completed"
      ? fromSettled({
          toolCallID: part.id,
          tool: part.name,
          input: part.state.input,
          structured: part.state.structured,
          content: part.state.content,
        })
      : [],
  )
}

/** What a settled retrieval yielded, shared by turn harvesting and by a recheck's direct re-run. */
export interface Settled {
  readonly toolCallID: string
  readonly tool: string
  readonly input: Readonly<Record<string, unknown>>
  readonly structured: unknown
  readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>
}

/** Identity of a recorded row: one source per tool call, so a fan-out tool yields one row per target. */
export function key(candidate: { readonly toolCallID: string; readonly source: SourceRef }) {
  return `${candidate.toolCallID}:${sourceKey(candidate.source)}`
}

export function sourceKey(source: SourceRef) {
  if (source.kind === "web") return `web:${source.url}`
  if (source.kind === "file") return `file:${normalizePath(source.path)}`
  if (source.kind === "search") return `search:${source.query.trim().toLowerCase()}`
  return `remote:${source.alias} ${source.command}`
}

/**
 * Match sources the collector claims to have consulted against what was actually harvested, so a
 * claimed source that no tool call produced is visible rather than silently believed.
 */
export function resolve(evidence: ReadonlyArray<Evidence>, sources: ReadonlyArray<SourceRef>) {
  const index = new Map<string, string[]>()
  for (const item of evidence) {
    const existing = index.get(sourceKey(item.source))
    if (existing) existing.push(item.id)
    if (!existing) index.set(sourceKey(item.source), [item.id])
  }
  const matched: string[] = []
  const unmatched: SourceRef[] = []
  for (const source of sources) {
    const found = index.get(sourceKey(source))
    if (!found) unmatched.push(source)
    if (found) matched.push(...found.filter((id) => !matched.includes(id)))
  }
  return { matched: matched as ReadonlyArray<string>, unmatched: unmatched as ReadonlyArray<SourceRef> }
}

export function describe(source: Source) {
  if (source.kind === "web") return source.title ? `${source.title} <${source.url}>` : source.url
  if (source.kind === "file") return source.path
  if (source.kind === "search") return `search: ${source.query}`
  return `${source.alias}$ ${source.command}${source.exit === undefined ? "" : ` (exit ${source.exit})`}`
}

/**
 * The evidence index handed to analyze, verify, and report. Only a preview travels in the prompt;
 * the stored excerpt is read on demand so the index stays bounded by row count, not by content.
 */
export function catalog(evidence: ReadonlyArray<Evidence>, preview = PREVIEW_CHARACTERS) {
  return evidence
    .map((item) =>
      [
        `- \`${item.id}\` (${item.source.kind}) ${describe(item.source)}`,
        `  ${clip(item.excerpt, preview).replaceAll("\n", " ").trim()}${item.excerpt.length > preview || item.truncated ? " …" : ""}`,
      ].join("\n"),
    )
    .join("\n")
}

export function fromSettled(settled: Settled): ReadonlyArray<Candidate> {
  const { toolCallID, tool } = settled
  const structured = asRecord(settled.structured) ?? {}
  if (tool === "webfetch") {
    const url = text(structured["url"]) ?? text(settled.input["url"])
    const body = text(structured["output"]) ?? modelText(settled)
    if (!url || !body.trim()) return []
    return [make(toolCallID, tool, { kind: "web", url }, body, false)]
  }
  if (tool === "websearch") {
    const query = text(settled.input["query"])
    const body = text(structured["text"]) ?? modelText(settled)
    if (!query || !body.trim()) return []
    return [make(toolCallID, tool, { kind: "search", query }, body, false)]
  }
  if (tool === "read") {
    const path = text(settled.input["path"])
    const body = modelText(settled)
    if (!path || !body.trim()) return []
    return [make(toolCallID, tool, { kind: "file", path }, body, false)]
  }
  if (tool === "remote_run") {
    const command = text(structured["command"]) ?? text(settled.input["command"])
    const results = structured["results"]
    if (!command || !Array.isArray(results)) return []
    return results.flatMap((result) => {
      const record = asRecord(result)
      const alias = record ? text(record["host"]) : undefined
      if (!record || !alias) return []
      const exit = typeof record["exit"] === "number" ? record["exit"] : undefined
      // The status line joins the body so a digest comparison also catches an exit-code change.
      const body = [
        `[${alias}] ${text(record["status"]) ?? "unknown"}${exit === undefined ? "" : ` (exit ${exit})`}`,
        text(record["stdout"]) ?? "",
        text(record["stderr"]) ? `stderr:\n${text(record["stderr"])}` : "",
      ]
        .filter((line) => line.length > 0)
        .join("\n")
      return [
        make(
          toolCallID,
          tool,
          { kind: "remote", alias, command, ...(exit === undefined ? {} : { exit }) },
          body,
          record["truncated"] === true,
        ),
      ]
    })
  }
  return []
}

/**
 * The tool call that re-retrieves a recorded source, mirroring the harvest mapping above. A
 * recheck is bounded to this function, so it can only re-run what a collector already ran: the
 * URL, path, query, and host alias all come from stored evidence and none can be introduced by a
 * prompt.
 */
export function retrieval(source: Source): { readonly tool: string; readonly input: Record<string, unknown> } {
  if (source.kind === "web") return { tool: "webfetch", input: { url: source.url, format: "markdown" } }
  if (source.kind === "search") return { tool: "websearch", input: { query: source.query } }
  if (source.kind === "file") return { tool: "read", input: { path: source.path } }
  return { tool: "remote_run", input: { hosts: [source.alias], command: source.command } }
}

function make(toolCallID: string, tool: string, source: Source, body: string, capped: boolean): Candidate {
  const full = body.trim()
  return {
    toolCallID,
    tool,
    source,
    excerpt: clip(full, MAX_EXCERPT_CHARACTERS),
    digest: Hash.sha256(full),
    truncated: capped || full.length > MAX_EXCERPT_CHARACTERS,
  }
}

function modelText(settled: Settled) {
  return settled.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n")
}

function text(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

function normalizePath(value: string) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "")
}

function clip(value: string, limit: number) {
  return value.length > limit ? value.slice(0, limit) : value
}
