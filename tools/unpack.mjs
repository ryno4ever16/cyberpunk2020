/**
 * Option B — extract compiled LevelDB compendium packs to reviewable JSON source under src/packs/.
 *
 * Source of truth = the LevelDB pack DIRECTORIES in packs/ (the data Foundry loads / the release
 * ships). The stale `*.db` NeDB single-files in packs/ are leftovers and are ignored here.
 *
 * Only packs REGISTERED in system.json are extracted. Orphan LevelDB dirs that exist on disk but
 * aren't declared in system.json (e.g. superseded `cyberware`/`smgs`, the un-wired `chipware`
 * catalog) are skipped so they don't get re-tracked. Pass an explicit name to override the filter.
 *
 * Workflow: edit in Foundry (writes LevelDB) -> `npm run unpack` -> commit the src/packs/ diff.
 * Round-trip: `npm run pack` rebuilds the LevelDB from src/packs/ (compiled packs/** stay gitignored).
 *
 * Usage: `npm run unpack` (all registered) or `node tools/unpack.mjs pistols ammo` (only named packs;
 *        an explicitly named pack is extracted even if unregistered).
 */
import { extractPack } from "@foundryvtt/foundryvtt-cli";
import { existsSync, readdirSync, statSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const PACKS = "packs";
const SRC = "src/packs";
const only = process.argv.slice(2);

// Pack names declared in system.json (the compendia Foundry actually loads).
// Lower-cased because a dir's on-disk case can differ from the registered name on
// case-insensitive filesystems (e.g. dir `sellTheDead` vs registered `sellthedead`).
const registered = new Set(
  (JSON.parse(readFileSync("system.json", "utf8")).packs ?? []).map((p) => p.name.toLowerCase())
);

/** A LevelDB pack dir = a directory with a CURRENT manifest pointer that is registered in system.json. */
const levelDbPacks = readdirSync(PACKS).filter((name) => {
  const dir = path.join(PACKS, name);
  let s; try { s = statSync(dir); } catch { return false; }
  if (!(s.isDirectory() && existsSync(path.join(dir, "CURRENT")))) return false;
  // Skip orphan dirs not in system.json, unless the caller named them explicitly.
  return registered.has(name.toLowerCase()) || only.includes(name);
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
