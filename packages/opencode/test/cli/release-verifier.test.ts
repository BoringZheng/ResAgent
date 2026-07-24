import { afterEach, describe, expect, test } from "bun:test"
import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { inspectRelease, parseChecksumManifest, releaseTarget, smokeBinary } from "../../script/verify-release"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("ResAgent release verifier", () => {
  test("maps supported native targets", () => {
    expect(releaseTarget("linux", "x64")).toBe("resagent-linux-x64")
    expect(releaseTarget("win32", "x64")).toBe("resagent-windows-x64")
  })

  test("parses checksum manifests and rejects duplicates", () => {
    const digest = "a".repeat(64)
    expect(parseChecksumManifest(`${digest}  resagent.zip\n`).get("resagent.zip")).toBe(digest)
    expect(() => parseChecksumManifest(`${digest}  resagent.zip\n${digest}  resagent.zip\n`)).toThrow(
      "duplicate archive names",
    )
  })

  test("checks ZIP checksum, member identity, and executable metadata", async () => {
    const dist = await temporaryDirectory()
    const target = releaseTarget("win32", "x64")
    const directory = path.join(dist, target)
    const source = path.join(dist, "source.exe")
    const archive = path.join(dist, `${target}.zip`)
    await mkdir(directory, { recursive: true })
    await Bun.write(source, "fixture")
    const writer = new ZipWriter(new BlobWriter("application/zip"))
    await writer.add("resagent.exe", new BlobReader(Bun.file(source)), { executable: true })
    await Bun.write(archive, await writer.close())
    await Bun.write(path.join(directory, "package.json"), JSON.stringify({ version: "1.2.3" }))
    const digest = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(archive).arrayBuffer())
      .digest("hex")
      .toLowerCase()
    await Bun.write(path.join(dist, "SHA256SUMS"), `${digest}  ${path.basename(archive)}\n`)

    const result = await inspectRelease({ dist, platform: "win32", arch: "x64" })
    expect(result).toMatchObject({
      target,
      version: "1.2.3",
      sha256: digest,
      binaryBytes: 7,
    })
    expect(await Bun.file(result.binary).text()).toBe("fixture")
    await result.cleanup()
  })

  test("runs a binary and verifies its exact version", async () => {
    await expect(smokeBinary(process.execPath, Bun.version)).resolves.toBe(Bun.version)
    await expect(smokeBinary(process.execPath, "not-the-bun-version")).rejects.toThrow("!=")
  })
})

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "resagent-verifier-test-"))
  directories.push(directory)
  return directory
}
