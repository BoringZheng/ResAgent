#!/usr/bin/env bun

import { BlobReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js"
import { chmod, mkdtemp, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

type SupportedPlatform = "linux" | "win32"
type SupportedArch = "x64" | "arm64"

export type ReleaseInspection = {
  readonly target: string
  readonly archive: string
  readonly binary: string
  readonly version: string
  readonly sha256: string
  readonly archiveBytes: number
  readonly binaryBytes: number
  readonly cleanup: () => Promise<void>
}

export function releaseTarget(platform: SupportedPlatform, arch: SupportedArch) {
  return `resagent-${platform === "win32" ? "windows" : platform}-${arch}`
}

export function parseChecksumManifest(input: string) {
  const entries = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i)
      if (!match) throw new Error(`Invalid SHA256SUMS line: ${line}`)
      return [match[2], match[1].toLowerCase()] as const
    })
  const result = new Map(entries)
  if (result.size !== entries.length) throw new Error("SHA256SUMS contains duplicate archive names")
  return result
}

export async function inspectRelease(input?: {
  readonly dist?: string
  readonly platform?: SupportedPlatform
  readonly arch?: SupportedArch
}): Promise<ReleaseInspection> {
  const dist = input?.dist ?? path.resolve(import.meta.dirname, "../dist")
  const platform = input?.platform ?? requirePlatform(process.platform)
  const arch = input?.arch ?? requireArch(process.arch)
  const target = releaseTarget(platform, arch)
  const archive = path.join(dist, `${target}.${platform === "linux" ? "tar.gz" : "zip"}`)
  const binaryName = platform === "win32" ? "resagent.exe" : "resagent"
  const expected = parseChecksumManifest(await Bun.file(path.join(dist, "SHA256SUMS")).text()).get(
    path.basename(archive),
  )
  if (!expected) throw new Error(`SHA256SUMS does not contain ${path.basename(archive)}`)
  if (!(await Bun.file(archive).exists())) throw new Error(`Release archive not found: ${archive}`)

  const sha256 = new Bun.CryptoHasher("sha256")
    .update(await Bun.file(archive).arrayBuffer())
    .digest("hex")
    .toLowerCase()
  if (sha256 !== expected) throw new Error(`Checksum mismatch for ${path.basename(archive)}: ${sha256} != ${expected}`)

  const directory = await mkdtemp(path.join(os.tmpdir(), "resagent-release-"))
  return (async () => {
    const binary = path.join(directory, binaryName)
    const metadata =
      platform === "linux"
        ? await inspectTar(archive, directory, binaryName)
        : await inspectZip(archive, binary, binaryName)
    const info = await stat(binary)
    if (platform !== "win32" && (info.mode & 0o111) === 0) {
      throw new Error(`${binaryName} is not executable after extraction`)
    }

    const manifest = (await Bun.file(path.join(dist, target, "package.json")).json()) as { version?: unknown }
    if (typeof manifest.version !== "string") {
      throw new Error(`Invalid release package metadata for ${target}`)
    }

    return {
      target,
      archive,
      binary,
      version: manifest.version,
      sha256,
      archiveBytes: Bun.file(archive).size,
      binaryBytes: metadata.size,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    }
  })().then(
    (value) => value,
    async (error) => {
      await rm(directory, { recursive: true, force: true })
      throw error
    },
  )
}

export async function smokeBinary(binary: string, expectedVersion: string) {
  const version = (await run([binary, "--version"], 15_000)).trim()
  if (version !== expectedVersion) throw new Error(`Extracted binary version ${version} != ${expectedVersion}`)
  return version
}

export async function verifyRelease(input?: {
  readonly dist?: string
  readonly platform?: SupportedPlatform
  readonly arch?: SupportedArch
}) {
  const inspected = await inspectRelease(input)
  const version = await smokeBinary(inspected.binary, inspected.version).finally(inspected.cleanup)
  return { ...inspected, version, cleanup: undefined }
}

async function inspectZip(archive: string, binary: string, binaryName: string) {
  const reader = new ZipReader(new BlobReader(Bun.file(archive)))
  return (async () => {
    const entries = (await reader.getEntries()).filter((entry) => !entry.directory)
    if (entries.length !== 1 || entries[0]?.filename !== binaryName) {
      throw new Error(`Expected one ${binaryName} member in ${path.basename(archive)}`)
    }
    const entry = entries[0]
    if (!entry.executable) {
      throw new Error(`${binaryName} lacks executable ZIP metadata`)
    }
    if (!entry.getData) {
      throw new Error(`${binaryName} cannot be extracted from ${path.basename(archive)}`)
    }
    const data = await entry.getData(new Uint8ArrayWriter())
    await Bun.write(binary, data)
    await chmod(binary, 0o755)
    return { size: entry.uncompressedSize }
  })().finally(() => reader.close())
}

async function inspectTar(archive: string, directory: string, binaryName: string) {
  const listing = await run(["tar", "-tvzf", archive])
  const lines = listing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length !== 1) throw new Error(`Expected one ${binaryName} member in ${path.basename(archive)}`)
  const fields = lines[0].split(/\s+/)
  if (fields.at(-1) !== binaryName) throw new Error(`Expected ${binaryName} in ${path.basename(archive)}`)
  if (!/^-rwx/.test(fields[0])) throw new Error(`${binaryName} lacks executable TAR metadata`)
  await run(["tar", "-xzf", archive, "-C", directory])
  return { size: Bun.file(path.join(directory, binaryName)).size }
}

async function run(command: string[], timeoutMs = 30_000) {
  const child = Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const timeout = { expired: false }
  const timer = setTimeout(() => {
    timeout.expired = true
    child.kill()
  }, timeoutMs)
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]).finally(() => clearTimeout(timer))
  if (timeout.expired) throw new Error(`${command.join(" ")} timed out after ${timeoutMs}ms`)
  if (exitCode !== 0) throw new Error(`${command.join(" ")} exited ${exitCode}: ${stderr.trim()}`)
  return stdout
}

function requirePlatform(platform: NodeJS.Platform): SupportedPlatform {
  if (platform === "linux" || platform === "win32") return platform
  throw new Error(`Unsupported release platform: ${platform}`)
}

function requireArch(arch: string): SupportedArch {
  if (arch === "x64" || arch === "arm64") return arch
  throw new Error(`Unsupported release architecture: ${arch}`)
}

if (import.meta.main) {
  const result = await verifyRelease()
  console.log(
    JSON.stringify(
      {
        target: result.target,
        version: result.version,
        archive: path.basename(result.archive),
        archiveBytes: result.archiveBytes,
        binaryBytes: result.binaryBytes,
        sha256: result.sha256,
      },
      null,
      2,
    ),
  )
}
