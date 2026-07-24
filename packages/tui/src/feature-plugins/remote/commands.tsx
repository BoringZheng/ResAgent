import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, createSignal } from "solid-js"

const id = "internal:remote-commands"
const selectedKey = (sessionID: string) => `resagent.remote.targets.${sessionID}`

function sessionID(api: TuiPluginApi) {
  const route = api.route.current
  if (route.name !== "session" || !("params" in route)) return
  return typeof route.params?.sessionID === "string" ? route.params.sessionID : undefined
}

function hosts(api: TuiPluginApi) {
  return Object.entries(api.state.config.remotes ?? {})
    .map(([alias, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return
      const tags =
        "tags" in value && Array.isArray(value.tags)
          ? value.tags.filter((tag): tag is string => typeof tag === "string")
          : []
      return { alias, description: tags.join(", ") || undefined }
    })
    .filter((item): item is { alias: string; description: string | undefined } => item !== undefined)
    .sort((a, b) => a.alias.localeCompare(b.alias))
}

function askCommand(api: TuiPluginApi, sessionID: string, selected: string[]) {
  api.ui.dialog.replace(() => (
    <api.ui.DialogPrompt
      title={`Run on ${selected.join(", ")}`}
      placeholder="Command for the remote login shell"
      onConfirm={(command) => {
        if (!command.trim()) return
        api.kv.set(selectedKey(sessionID), selected)
        api.ui.dialog.clear()
        void api.client.tui
          .appendPrompt(
            {
              text: `Use remote_run to run ${JSON.stringify(command.trim())} on exactly these configured hosts: ${selected.join(", ")}.`,
            },
            { throwOnError: true },
          )
          .catch((error) => {
            api.ui.toast({
              variant: "error",
              message: error instanceof Error ? error.message : String(error),
            })
          })
      }}
    />
  ))
}

function Picker(props: { api: TuiPluginApi; sessionID: string }) {
  const configured = hosts(props.api)
  const [selected, setSelected] = createSignal(
    (props.api.kv.get<string[]>(selectedKey(props.sessionID), []) ?? []).filter((alias) =>
      configured.some((item) => item.alias === alias),
    ),
  )
  const options = createMemo(() => [
    {
      title: selected().length ? `Run on ${selected().join(", ")}` : "Select one or more hosts",
      value: "__continue__",
      description: selected().length ? "Continue to command" : "Choose hosts below",
      disabled: selected().length === 0,
    },
    ...configured.map((item) => ({
      title: `${selected().includes(item.alias) ? "✓" : " "} ${item.alias}`,
      value: item.alias,
      description: item.description,
    })),
  ])

  return (
    <props.api.ui.DialogSelect
      title="Remote hosts"
      options={options()}
      onSelect={(item) => {
        if (item.value === "__continue__") {
          askCommand(props.api, props.sessionID, selected())
          return
        }
        setSelected((current) =>
          current.includes(item.value) ? current.filter((alias) => alias !== item.value) : [...current, item.value],
        )
      }}
    />
  )
}

function show(api: TuiPluginApi) {
  const current = sessionID(api)
  if (!current) {
    api.ui.toast({ variant: "warning", message: "Open a session before selecting remote hosts" })
    return
  }
  if (hosts(api).length === 0) {
    api.ui.toast({ variant: "warning", message: "No remote hosts are configured" })
    return
  }
  api.ui.dialog.replace(() => <Picker api={api} sessionID={current} />)
}

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "remote.hosts",
        title: "Remote hosts",
        category: "Research",
        namespace: "palette",
        run() {
          show(api)
        },
      },
    ],
    bindings: [],
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
