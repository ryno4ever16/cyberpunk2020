/**
 * Option B — extract compiled LevelDB compendium packs to reviewable JSON source under src/packs/.
 *
 * Source of truth = the LevelDB pack DIRECTORIES in packs/ (the data Foundry loads / the release
 * ships). The stale `*.db` NeDB single-files in packs/ are leftovers and are ignored here.
 *
 * Workflow: edit in Foundry (writes LevelDB) -> `npm run unpack` -> commit the src/packs/ diff.
 * Round-trip: `npm run pack` rebuilds the LevelDB from src/packs/ (compiled packs/** stay gitignored).
 *
 * Usage: `npm run unpack` (all) or `node tools/unpack.mjs pistols ammo` (only named packs).
 */
import { extractPack } from "@foundryvtt/foundryvtt-cli";
import { existsSync, readdirSync, statSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";

const PACKS = "packs";
const SRC = "src/packs";
const only = process.argv.slice(2);

/** A LevelDB pack dir = a directory containing a CURRENT manifest pointer. */
const levelDbPacks = readdirSync(PACKS).filter((name) => {
  const dir = path.join(PACKS, name);
  let s; try { s = statSync(dir); } catch { return false; }
  return s.isDirectory() && existsSync(path.join(dir, "CURRENT"));
});

let n = 0;
for (const name of levelDbPacks) {
  if (only.length && !only.includes(name)) continue;
  const src = path.join(PACKS, name);
  const dest = path.join(SRC, name);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  try {
    await extractPack(src, dest, { yaml: false, jsonOptions: { space: 2 }, log: false });
    console.log(`unpacked ${name} -> ${dest}`);
    n++;
  } catch (e) {
    console.error(`FAILED ${name}: ${e.message} (is a local Foundry world holding the pack LOCK?)`);
  }
}
console.log(`done — ${n} pack(s) extracted`);
