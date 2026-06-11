/**
 * Unit tests for pure exported functions in module/migrate.js.
 *
 * Tested (fully pure):
 *   - convertOldSkill — normalizes a legacy world-template skill entry into a
 *                       skill Item creation payload; handles value/level/rank,
 *                       IP/ip, diffMod/ipmod, isChipped/chipped fallbacks and
 *                       the trained-defaults-to-(level > 0) rule
 *
 * Skipped (async; Foundry document reads/writes, game.* access):
 *   - migrateWorld       — game.actors / game.items / game.packs iteration + updates
 *   - migrateActor       — Actor#update / createEmbeddedDocuments
 *   - migrateItem        — Item#update
 *   - migrateCompendium  — compendium unlock + updateDocuments
 *   - migrateAmmoCalibers — game.items + pack document updates
 */

import { describe, it, expect } from "vitest";
import { convertOldSkill } from "../../module/migrate.js";

describe("convertOldSkill", () => {
  it("converts a legacy {value, IP} entry (Handgun)", () => {
    const out = convertOldSkill("Handgun", { value: 5, IP: 10 });
    expect(out.name).toBe("Handgun");
    expect(out.type).toBe("skill");
    expect(out.system.level).toBe(5);
    expect(out.system.ip).toBe(10);
    expect(out.system.IP).toBe(10);
    expect(out.system.diffMod).toBe(1);
    expect(out.system.stat).toBe("cool");
    expect(out.system.trained).toBe(true);
    expect(out.system.isChipped).toBe(false);
    expect(out.system.autoChipped).toBe(false);
    expect(out.system.flavor).toBe("");
  });

  it("uses rank and ipmod fallbacks and keeps an explicit stat (Awareness)", () => {
    const out = convertOldSkill("Awareness", { rank: 3, ipmod: 2, stat: "int" });
    expect(out.system.level).toBe(3);       // rank fallback
    expect(out.system.diffMod).toBe(2);     // ipmod fallback
    expect(out.system.stat).toBe("int");
    expect(out.system.trained).toBe(true);  // level > 0 → trained by default
  });

  it("produces safe defaults for an empty legacy object", () => {
    const out = convertOldSkill("Empty", {});
    expect(out.system.level).toBe(0);
    expect(out.system.ip).toBe(0);
    expect(out.system.IP).toBe(0);
    expect(out.system.diffMod).toBe(1);
    expect(out.system.trained).toBe(false); // level 0 → untrained
    expect(out.system.stat).toBe("cool");
    expect(out.system.isChipped).toBe(false);
    expect(out.system.chipLevel).toBe(0);
  });

  it("honors the legacy `chipped` flag and chipLevel (Chipped)", () => {
    const out = convertOldSkill("Chipped", { level: 2, chipped: true, chipLevel: 4 });
    expect(out.system.isChipped).toBe(true); // chipped fallback
    expect(out.system.chipLevel).toBe(4);
    expect(out.system.level).toBe(2);
    expect(out.system.trained).toBe(true);
  });

  it("explicit trained:false wins over the level>0 default (Role)", () => {
    const out = convertOldSkill("Role", { value: 1, isRoleSkill: true, trained: false });
    expect(out.system.isRoleSkill).toBe(true);
    expect(out.system.trained).toBe(false); // explicit override, even though level > 0
    expect(out.system.level).toBe(1);
  });

  it("works with only a name (defaulted second argument)", () => {
    const out = convertOldSkill("Bare");
    expect(out.name).toBe("Bare");
    expect(out.type).toBe("skill");
    expect(out.system.level).toBe(0);
    expect(out.system.trained).toBe(false);
  });
});
