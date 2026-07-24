export type RemoteRunHostResult = {
  host: string
  status: "ok" | "failed" | "timeout"
  exit?: number
  duration_ms: number
  stdout: string
  stderr: string
  truncated: boolean
}

export type RemoteRunResult = {
  command: string
  results: RemoteRunHostResult[]
}

export function parseRemoteRunResult(value: unknown): RemoteRunResult | undefined {
  const result = record(value)
  if (!result || typeof result.command !== "string" || !Array.isArray(result.results)) return
  const hosts = result.results.map(parseHost)
  if (hosts.some((item) => item === undefined)) return
  return { command: result.command, results: hosts as RemoteRunHostResult[] }
}

function parseHost(value: unknown): RemoteRunHostResult | undefined {
  const result = record(value)
  if (!result) return
  if (typeof result.host !== "string") return
  if (result.status !== "ok" && result.status !== "failed" && result.status !== "timeout") return
  if (result.exit !== undefined && (typeof result.exit !== "number" || !Number.isFinite(result.exit))) return
  if (typeof result.duration_ms !== "number" || !Number.isFinite(result.duration_ms)) return
  if (typeof result.stdout !== "string" || typeof result.stderr !== "string") return
  if (typeof result.truncated !== "boolean") return
  return {
    host: result.host,
    status: result.status,
    exit: result.exit,
    duration_ms: result.duration_ms,
    stdout: result.stdout,
    stderr: result.stderr,
    truncated: result.truncated,
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}
