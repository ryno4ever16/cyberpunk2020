import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow } from "../helpers/foundry.js";

/**
 * Vehicle — Phase 6-1: PURE ACPA combat math (Maximum Metal p.52-60). No documents; just imports the
 * module and checks the System Hit / Critical / Integrity / melee / movement functions vs the book.
 */
test("Phase 6-1: ACPA combat math (pure, MM p.52-60)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);

  const R = await evalGameOrThrow(page, async () => {
    const A = await import("/systems/cyberpunk2020/module/vehicle/vehicle-acpa.js");
    return {
      ext5: A.externalSystemHit(5), ext6: A.externalSystemHit(6), ext1: A.externalSystemHit(1),
      sh2: A.acpaSystemHit(2), sh5: A.acpaSystemHit(5), sh8: A.acpaSystemHit(8), sh10: A.acpaSystemHit(10),
      ra2: A.acpaRollAgain(2), ra3: A.acpaRollAgain(3),
      intHalf: A.systemIntegrity({ sopLost: 5, sopTotal: 10 }),
      intLow: A.systemIntegrity({ sopLost: 2, sopTotal: 10 }),
      intDead: A.systemIntegrity({ sopLost: 11, sopTotal: 10 }),
      crit1: A.acpaCriticalEffect(1).type, crit3: A.acpaCriticalEffect(3).type, crit4: A.acpaCriticalEffect(4).type,
      crit6: A.acpaCriticalEffect(6).type, crit8: A.acpaCriticalEffect(8).type, crit9: A.acpaCriticalEffect(9).type, crit10: A.acpaCriticalEffect(10).type,
      punch36: A.acpaMeleeDamage(36, "punch"), crush36: A.acpaMeleeDamage(36, "crush"), kick36: A.acpaMeleeDamage(36, "kick"),
      punch18: A.acpaMeleeDamage(18, "punch"), kick45: A.acpaMeleeDamage(45, "kick"),
      run: A.acpaRunM({ sib: 5, ma: 8 }),
      jumpRun: A.acpaJumpM(39, { running: true }), jumpStat: A.acpaJumpM(39, { running: false }), jumpVert: A.acpaJumpM(39, { running: true, vertical: true }),
      lfBasic: A.linearFrameHitChance(14), lfAdv: A.linearFrameHitChance(30),
    };
  });

  console.log("Phase 6-1:", JSON.stringify(R));
  expect(R.ext5).toBe(true);  expect(R.ext6).toBe(false);  expect(R.ext1).toBe(true);
  expect(R.sh2).toBe("chassis"); expect(R.sh5).toBe("enclosed"); expect(R.sh8).toBe("weapons"); expect(R.sh10).toBe("rollAgain");
  expect(R.ra2).toBe("critical"); expect(R.ra3).toBe("systemHit");
  expect(R.intHalf).toEqual({ destroyed: false, inopChance: 0.75 });   // ≥ ½ SOP
  expect(R.intLow).toEqual({ destroyed: false, inopChance: 0.25 });    // < ½ SOP
  expect(R.intDead.destroyed).toBe(true);                              // exceeded
  expect(R.crit1).toBe("seizeUp"); expect(R.crit3).toBe("cooling"); expect(R.crit4).toBe("strLoss");
  expect(R.crit6).toBe("refLoss"); expect(R.crit8).toBe("powerLoss"); expect(R.crit9).toBe("interfaceOut"); expect(R.crit10).toBe("mechShock");
  // Melee: STR36 → X=4 → punch 4d10, crush 5d10, kick round(1.5×4)=6d10; STR18 → X=2 → punch 2d10; STR45 → X=5 → kick round(7.5)=8d10.
  expect(R.punch36.dice).toBe(4); expect(R.crush36.dice).toBe(5); expect(R.kick36.dice).toBe(6);
  expect(R.punch18.dice).toBe(2); expect(R.kick45.dice).toBe(8);
  // Movement: run (5+8)×3 = 39; running jump /4 = 9.75; standing /6 = 6.5; vertical = horizontal/3.
  expect(R.run).toBe(39);
  expect(R.jumpRun).toBeCloseTo(9.75, 2); expect(R.jumpStat).toBeCloseTo(6.5, 2); expect(R.jumpVert).toBeCloseTo(3.25, 2);
  expect(R.lfBasic).toBe(0.2); expect(R.lfAdv).toBe(0.3);
});
