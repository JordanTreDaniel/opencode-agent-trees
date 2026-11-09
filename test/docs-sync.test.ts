import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))

test("recursive recovery page is byte-identical to the canonical feature record", async () => {
  const result = spawnSync("node", ["scripts/render-wake-up.mjs", "--stdout"], { cwd: root, encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const onDisk = await readFile(new URL("../docs/features/recursive-wake-up.md", import.meta.url), "utf8")
  assert.equal(onDisk, result.stdout)
})

test("feature catalog validates against its JSON Schema", () => {
  const result = spawnSync("python3", [
    "-c",
    "import json, jsonschema; schema=json.load(open('docs/features/schema.json')); catalog=json.load(open('docs/features/features.json')); jsonschema.Draft202012Validator(schema).validate(catalog)",
  ], { cwd: root, encoding: "utf8" })

  assert.equal(result.status, 0, result.stderr || result.stdout)
})
