import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * "Connector tokens are never stored on the computer."
 *
 * Checked two ways. Structurally: nothing a Bot's computer runs (agent-computer) and nothing the
 * server sends it through (server/src/computer) can reach the credential vault or the connector
 * store. (The supervisor that built per-Bot computer environments was removed in slimming P3.)
 */
const root = join(import.meta.dir, "..", "..");

async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? sources(join(directory, entry.name))
        : entry.name.endsWith(".ts")
          ? [join(directory, entry.name)]
          : [],
    ),
  );
  return files.flat();
}

const FORBIDDEN =
  /from\s+["'](?:\.\.\/)+(?:credentials|plugins\/[^"']*|passwords\/(?:store|service)|provider-oauth[^"']*|google-oauth-transport)["']/;

describe("connector tokens never reach a Bot's computer", () => {
  test("the computer and the server's computer module import no credential or connector code", async () => {
    const files = [
      ...(await sources(join(root, "agent-computer", "src"))),
      ...(await sources(join(root, "server", "src", "computer"))),
    ];
    expect(files.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      if (FORBIDDEN.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
