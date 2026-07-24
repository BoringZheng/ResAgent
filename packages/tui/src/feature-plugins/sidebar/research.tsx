import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show } from "solid-js"
import { useData } from "../../context/data"
import { researchStages } from "../../util/research-state"
import { Locale } from "../../util/locale"

const id = "internal:sidebar-research"

export function ResearchSidebar(props: { api: TuiPluginApi; session_id: string }) {
  const data = useData()
  const theme = () => props.api.theme.current
  const research = createMemo(() => data.session.research.get(props.session_id))
  const providers = createMemo(() => new Set((data.location.provider.list() ?? []).map((item) => item.id)))

  return (
    <Show when={research()}>
      {(run) => (
        <box>
          <text fg={theme().text}>
            <b>Research</b>
            <span style={{ fg: theme().textMuted }}> · {run().profile}</span>
          </text>
          <For each={researchStages}>
            {(name) => {
              const stage = createMemo(() => run().stages.find((item) => item.stage === name))
              const attempt = createMemo(() => stage()?.attempts.at(-1))
              return (
                <box>
                  <text
                    fg={
                      stage()?.status === "completed"
                        ? theme().success
                        : stage()?.status === "active"
                          ? theme().text
                          : theme().textMuted
                    }
                  >
                    {stage()?.status === "completed" ? "✓" : stage()?.status === "active" ? "›" : "·"}{" "}
                    {Locale.titlecase(name)}
                  </text>
                  <Show when={attempt()}>
                    {(item) => (
                      <text fg={item().status === "terminal-failure" ? theme().error : theme().textMuted}>
                        {item().entry} · attempt {item().attempt} · {item().status}
                      </text>
                    )}
                  </Show>
                  <Show when={stage()?.status === "active" && stage()?.route.length}>
                    <text fg={theme().textMuted}>
                      {stage()!
                        .route.map((entry) => {
                          const provider = entry.split("/", 1)[0] ?? entry
                          return `${entry}${providers().has(provider) ? "" : " (unavailable)"}`
                        })
                        .join(" → ")}
                    </text>
                  </Show>
                </box>
              )
            }}
          </For>
          <Show when={run().reportPath}>
            <text fg={theme().textMuted}>Report: {run().reportPath}</text>
          </Show>
          <Show when={run().error}>
            <text fg={theme().error}>{run().error}</text>
          </Show>
        </box>
      )}
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 350,
    slots: {
      sidebar_content(_ctx, props) {
        return <ResearchSidebar api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
