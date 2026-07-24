import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"

const id = "internal:research-commands"

function sessionID(api: TuiPluginApi) {
  const route = api.route.current
  if (route.name !== "session" || !("params" in route)) return
  return typeof route.params?.sessionID === "string" ? route.params.sessionID : undefined
}

function profiles(api: TuiPluginApi) {
  return Object.keys(api.state.config.research?.profiles ?? {}).sort()
}

function askQuestion(api: TuiPluginApi, profile?: string, path?: string) {
  api.ui.dialog.replace(() => (
    <api.ui.DialogPrompt
      title="Research question"
      placeholder="What should ResAgent investigate?"
      onConfirm={(question) => {
        const current = sessionID(api)
        if (!current || !question.trim()) return
        api.ui.dialog.clear()
        api.ui.toast({ variant: "info", message: `Research started${profile ? ` with ${profile}` : ""}` })
        void api.client.v2.session
          .research(
            {
              sessionID: current,
              question: question.trim(),
              profile,
              path,
            },
            { throwOnError: true },
          )
          .then((result) => {
            api.ui.toast({
              variant: "success",
              title: "Research complete",
              message: result.data.data.reportPath,
              duration: 8000,
            })
          })
          .catch((error) => {
            api.ui.toast({
              variant: "error",
              title: "Research failed",
              message: error instanceof Error ? error.message : String(error),
              duration: 8000,
            })
          })
      }}
    />
  ))
}

function selectProfile(api: TuiPluginApi, path?: string) {
  const list = profiles(api)
  if (list.length <= 1) {
    askQuestion(api, list[0], path)
    return
  }
  const selected = api.state.config.research?.default_profile
  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title="Research profile"
      current={selected}
      options={list.map((profile) => ({
        title: profile,
        value: profile,
        description: profile === selected ? "Default" : undefined,
      }))}
      onSelect={(item) => askQuestion(api, item.value, path)}
    />
  ))
}

function start(api: TuiPluginApi, output: boolean) {
  if (!sessionID(api)) {
    api.ui.toast({ variant: "warning", message: "Open a session before starting research" })
    return
  }
  if (!output) {
    selectProfile(api)
    return
  }
  api.ui.dialog.replace(() => (
    <api.ui.DialogPrompt
      title="Report path"
      value=".resagent/reports/report.md"
      placeholder=".resagent/reports/report.md"
      onConfirm={(value) => selectProfile(api, value.trim() || undefined)}
    />
  ))
}

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "research.start",
        title: "Start research",
        category: "Research",
        namespace: "palette",
        run() {
          start(api, false)
        },
      },
      {
        name: "research.start.output",
        title: "Start research with report path",
        category: "Research",
        namespace: "palette",
        run() {
          start(api, true)
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
