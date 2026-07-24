const standaloneDistribution = process.env.RESAGENT_DISTRIBUTION === "1"

export function commandName(env: NodeJS.ProcessEnv = process.env) {
  return standaloneDistribution || env.RESAGENT_DISTRIBUTION === "1" || env.RESAGENT_LAUNCH === "1"
    ? "resagent"
    : "opencode"
}
