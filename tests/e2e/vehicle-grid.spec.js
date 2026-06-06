import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow } from "../helpers/foundry.js";

/**
 * Vehicle — grid/units conversions (vehicle-grid.js). PURE; no documents created. Confirms the
 * meters↔pixels/units helpers scale to any grid size AND respect non-metre units (the robustness
 * the user asked for), and degrade gracefully on a zero/blank grid.
 */
test("vehicle-grid: meters↔pixels respect grid units + guards", async ({ page }) => {
  await login(page, ACCOUNTS.gm);

  const R = await evalGameOrThrow(page, async () => {
    const G = await import("/systems/cyberpunk2020/module/vehicle/vehicle-grid.js");
    const sM = { grid: { size: 100, distance: 2, units: "m" } };     // 50 px/m
    const sFt = { grid: { size: 100, distance: 5, units: "ft" } };   // (20 px/ft) / 0.3048 = 65.617 px/m
    const sZero = { grid: { size: 100, distance: 0, units: "" } };   // guarded → 100 px/m
    return {
      mpuM: G.metersPerUnit(sM), mpuFt: G.metersPerUnit(sFt), mpuKm: G.metersPerUnit({ grid: { units: "km" } }), mpuBlank: G.metersPerUnit({ grid: {} }),
      ppmM: G.pxPerMeter(sM), ppmFt: G.pxPerMeter(sFt), ppmZero: G.pxPerMeter(sZero),
      toPxM: G.metersToPixels(sM, 60),         // 60m × 50 = 3000
      toMM: G.pixelsToMeters(sM, 3000),        // 3000 / 50 = 60
      unitsM: G.metersToUnits(sM, 6),          // 6m = 6 units (metre grid)
      unitsFt: G.metersToUnits(sFt, 6),        // 6m = 19.685 ft
    };
  });

  console.log("vehicle-grid:", JSON.stringify(R));
  expect(R.mpuM).toBe(1);
  expect(R.mpuFt).toBeCloseTo(0.3048, 4);
  expect(R.mpuKm).toBe(1000);
  expect(R.mpuBlank).toBe(1);
  expect(R.ppmM).toBe(50);
  expect(R.ppmFt).toBeCloseTo(65.617, 2);
  expect(R.ppmZero).toBe(100);               // distance 0 guarded to 1
  expect(R.toPxM).toBe(3000);
  expect(R.toMM).toBe(60);
  expect(R.unitsM).toBe(6);
  expect(R.unitsFt).toBeCloseTo(19.685, 2);
});
