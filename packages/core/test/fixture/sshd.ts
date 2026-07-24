import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { tmpdir } from "./tmpdir"

export interface SshdServer {
  readonly port: number
  readonly hostKey: string
  readonly knownHostsLine: string
  readonly connections: () => number
  readonly log: () => string
}

export interface SshdFixture {
  readonly path: string
  readonly user: string
  readonly clientKey: string
  readonly knownHostsFile: string
  readonly servers: ReadonlyArray<SshdServer>
  readonly [Symbol.asyncDispose]: () => Promise<void>
}

export const available = [Bun.which("ssh"), Bun.which("sshd"), Bun.which("ssh-keygen")].every((item) => item !== null)

export async function sshdFixture(count = 2): Promise<SshdFixture> {
  if (!available) throw new Error("OpenSSH client, server, and key generator are required")
  const root = await tmpdir()
  const clientKey = path.join(root.path, "client")
  await command(Bun.which("ssh-keygen")!, ["-q", "-t", "ed25519", "-N", "", "-f", clientKey])
  const authorizedKeys = path.join(root.path, "authorized_keys")
  await fs.copyFile(`${clientKey}.pub`, authorizedKeys)
  const processes: ChildProcessWithoutNullStreams[] = []
  const servers = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      startServer({
        root: root.path,
        index,
        authorizedKeys,
        process: (process) => processes.push(process),
      }),
    ),
  )
  const knownHostsFile = path.join(root.path, "known_hosts")
  await fs.writeFile(knownHostsFile, `${servers.map((server) => server.knownHostsLine).join("\n")}\n`)

  return {
    path: root.path,
    user: process.env.USERNAME ?? process.env.USER ?? os.userInfo().username,
    clientKey,
    knownHostsFile,
    servers,
    async [Symbol.asyncDispose]() {
      await Promise.all(processes.map(stop))
      await root[Symbol.asyncDispose]()
    },
  }
}

async function startServer(input: {
  readonly root: string
  readonly index: number
  readonly authorizedKeys: string
  readonly process: (process: ChildProcessWithoutNullStreams) => void
}) {
  const port = await freePort()
  const hostKey = path.join(input.root, `host-${input.index}`)
  await command(Bun.which("ssh-keygen")!, ["-q", "-t", "ed25519", "-N", "", "-f", hostKey])
  const config = path.join(input.root, `sshd-${input.index}.config`)
  await fs.writeFile(
    config,
    [
      `Port ${port}`,
      "ListenAddress 127.0.0.1",
      `HostKey ${configPath(hostKey)}`,
      `PidFile ${configPath(path.join(input.root, `sshd-${input.index}.pid`))}`,
      `AuthorizedKeysFile ${configPath(input.authorizedKeys)}`,
      "PubkeyAuthentication yes",
      "PasswordAuthentication no",
      "KbdInteractiveAuthentication no",
      "StrictModes no",
      "PermitEmptyPasswords no",
      "AllowTcpForwarding no",
      "X11Forwarding no",
      "PermitTunnel no",
      "GatewayPorts no",
      "LogLevel VERBOSE",
      "",
    ].join("\n"),
  )
  await command(Bun.which("sshd")!, ["-t", "-f", config])
  const process = spawn(Bun.which("sshd")!, ["-D", "-e", "-f", config], {
    windowsHide: true,
    stdio: "pipe",
  })
  input.process(process)
  const logs: string[] = []
  process.stdout.on("data", (chunk) => logs.push(chunk.toString()))
  process.stderr.on("data", (chunk) => logs.push(chunk.toString()))
  await waitUntil(
    () => logs.join("").includes("Server listening"),
    () => process.exitCode !== null,
  )
  const publicKey = (await fs.readFile(`${hostKey}.pub`, "utf8")).trim().split(/\s+/)
  return {
    port,
    hostKey,
    knownHostsLine: `[127.0.0.1]:${port} ${publicKey[0]} ${publicKey[1]}`,
    connections: () => logs.join("").split("Connection from ").length - 1,
    log: () => logs.join(""),
  }
}

async function command(executable: string, args: ReadonlyArray<string>) {
  const process = Bun.spawn([executable, ...args], { stdout: "pipe", stderr: "pipe" })
  const [exit, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  if (exit === 0) return stdout
  throw new Error(`${executable} failed with exit ${exit}: ${stderr.trim()}`)
}

async function freePort() {
  const net = await import("node:net")
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close()
        reject(new Error("Unable to allocate an SSH test port"))
        return
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
}

async function waitUntil(ready: () => boolean, exited: () => boolean, timeout = 5_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (ready()) return
    if (exited()) throw new Error("Disposable sshd exited before listening")
    await Bun.sleep(25)
  }
  throw new Error("Disposable sshd did not start before the timeout")
}

async function stop(process: ChildProcessWithoutNullStreams) {
  if (process.exitCode !== null || process.signalCode !== null) return
  const exited = new Promise<void>((resolve) => process.once("exit", () => resolve()))
  process.kill()
  await Promise.race([
    exited,
    Bun.sleep(2_000).then(() => {
      if (process.exitCode === null && process.signalCode === null) process.kill("SIGKILL")
    }),
  ])
}

function configPath(value: string) {
  return `"${value.replaceAll("\\", "/").replaceAll('"', '\\"')}"`
}
