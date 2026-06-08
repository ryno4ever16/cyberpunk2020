/**
 * Option B — compile JSON source (src/packs/) back into the LevelDB pack directories Foundry loads.
 * Inverse of tools/unpack.mjs. The compiled packs/** stay gitignored; src/packs/ is the tracked source.
 *
 * Usage: `npm run pack` (all) or `node tools/pack.mjs pistols ammo` (only named packs).
 */
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const SRC = "src/packs";
const PACKS = "packs";
const only = process.argv.slice(2);

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
