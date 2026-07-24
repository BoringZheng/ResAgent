import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, Show } from "solid-js"
import { useData } from "../../context/data"

const id = "internal:sidebar-remote"
const selectedKey = (sessionID: string) => `resagent.remote.targets.${sessionID}`

export function RemoteSidebar(props: { api: TuiPluginApi; session_id: string }) {
  const data = useData()
  const theme = () => props.api.theme.current
  const active = createMemo(() => {
    const selected = data.session.message
      .list(props.session_id)
      ?.flatMap((message) => (message.type === "assistant" ? message.content : []))
      .findLast((part) => part.type === "tool" && part.name === "remote_run" && part.state.status === "running")
    if (selected?.type !== "tool" || selected.state.status !== "running") return
    return Array.isArray(selected.state.input.hosts)
      ? selected.state.input.hosts.filter((host): host is string => typeof host === "string")
      : undefined
  })
  const staged = createMemo(() => props.api.kv.get<string[]>(selectedKey(props.session_id), []) ?? [])
  const aliases = createMemo(() => active() ?? staged())

  return (
    <Show when={aliases().length}>
      <box>
        <text fg={theme().text}>
          <b>{active() ? "Active Targets" : "Remote Targets"}</b>
        </text>
        <text fg={theme().textMuted}>{aliases().join(", ")}</text>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 325,
    slots: {
      sidebar_content(_ctx, props) {
        return <RemoteSidebar api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
