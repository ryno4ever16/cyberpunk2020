/**
 * Option B — compile JSON source (src/packs/) back into the LevelDB pack directories Foundry loads.
 * Inverse of tools/unpack.mjs. The compiled packs/** stay gitignored; src/packs/ is the tracked source.
 *
 * Usage: `npm run pack` (all) or `node tools/pack.mjs pistols ammo` (only named packs).
 */
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

const SRC = "src/packs";
const PACKS = "packs";
const only = process.argv.slice(2);

// Strip any legacy NeDB ".db" FILES before building. Foundry probes "<pack>.db" on load and, if it finds
// one, runs a NeDB->LevelDB migration that must WRITE into the system folder — which fails on fresh,
// read-only/locked-down installs (Linux/Unraid Docker) and leaves compendiums blank (and characters with
// no seeded skills). The LevelDB pack DIRECTORIES are the real data; these .db files are stale cruft that
// must never ship. See memory bug-linux-nedb-packs. (Runs every build, even for named-pack runs.)
let purged = 0;
for (const f of readdirSync(PACKS)) {
  if (!f.endsWith(".db")) continue;
  const fp = path.join(PACKS, f);
  try { if (statSync(fp).isFile()) { unlinkSync(fp); purged++; } } catch { /* gone */ }
}
if (purged) console.log(`purged ${purged} stale legacy .db file(s) from ${PACKS}/ (Foundry NeDB-migration footgun)`);

let n = 0;
for (const name of readdirSync(SRC)) {
  if (only.length && !only.includes(name)) continue;
  const src = path.join(SRC, name);
  let s; try { s = statSync(src); } catch { continue; }
  if (!s.isDirectory()) continue;
  const dest = path.join(PACKS, name);
  await compilePack(src, dest, { yaml: false, log: false });
  console.log(`packed ${name} -> ${dest}`);
  n++;
}
console.log(`done — ${n} pack(s) compiled`);
