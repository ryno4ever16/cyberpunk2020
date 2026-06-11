/**
 * Unit tests for pure exported functions in module/shop/services.js.
 *
 * Tested (fully pure, no Foundry deps):
 *   - SERVICE_MODES   — the explicit-override vocabulary
 *   - classifyService — item (+ optional pack name) → "gear" | "recurring" | "oneoff"
 *
 * Skipped (async Foundry):
 *   - payOneOffService — actor.update / ui.notifications / canShop() / ChatMessage.create
 *   - payService       — actor.update / ui.notifications / ChatMessage.create
 */

import { describe, it, expect } from "vitest";
import {
  classifyService,
  SERVICE_MODES,
} from "../../module/shop/services.js";

// ─── SERVICE_MODES ────────────────────────────────────────────────────────────

describe("SERVICE_MODES", () => {
  it("is exactly gear / recurring / oneoff", () => {
    expect(SERVICE_MODES).toEqual(["gear", "recurring", "oneoff"]);
  });
});

// ─── classifyService: explicit override ───────────────────────────────────────

describe("classifyService — explicit serviceMode override", () => {
  it("an explicit serviceMode wins over everything (case-insensitive, trimmed)", () => {
    expect(classifyService({ system: { serviceMode: "GEAR" } })).toBe("gear");
    expect(classifyService({ system: { serviceMode: "recurring" } })).toBe("recurring");
    expect(classifyService({ system: { serviceMode: "  oneoff  " } })).toBe("oneoff");
  });

  it("override beats a contradicting keyword in the name", () => {
    // "Taxi Ride" would keyword-classify as oneoff; the override forces gear.
    expect(classifyService({ name: "Taxi Ride", system: { serviceMode: "gear" } })).toBe("gear");
    // "Apartment Rent" would keyword-classify as recurring; the override forces oneoff.
    expect(classifyService({ name: "Apartment Rent", system: { serviceMode: "oneoff" } })).toBe("oneoff");
  });

  it("an invalid serviceMode is ignored and falls through to inference", () => {
    expect(classifyService({ name: "Taxi Ride", system: { serviceMode: "bogus" } })).toBe("oneoff");
    expect(classifyService({ name: "Mystery Widget", system: { serviceMode: "bogus" } })).toBe("gear");
  });
});

// ─── classifyService: keyword inference ───────────────────────────────────────

describe("classifyService — keyword inference on the item name", () => {
  it("one-off keywords classify as oneoff", () => {
    expect(classifyService({ name: "Taxi Ride" })).toBe("oneoff");
    expect(classifyService({ name: "Airline Fare" })).toBe("oneoff");
    expect(classifyService({ name: "Docking Fee" })).toBe("oneoff");
    expect(classifyService({ name: "Generic Food" })).toBe("oneoff");
    expect(classifyService({ name: "Hotel Room" })).toBe("oneoff");
    expect(classifyService({ name: "Full Body Clone" })).toBe("oneoff");
    expect(classifyService({ name: "Bodyguard for Hire" })).toBe("oneoff");
    expect(classifyService({ name: "Weapon Repair" })).toBe("oneoff");
    expect(classifyService({ name: "Braindance Session" })).toBe("oneoff");
  });

  it("recurring keywords classify as recurring", () => {
    expect(classifyService({ name: "Apartment Rent" })).toBe("recurring");
    expect(classifyService({ name: "Trauma Team Insurance" })).toBe("recurring");
    expect(classifyService({ name: "Data Subscription" })).toBe("recurring");
    expect(classifyService({ name: "Vehicle Lease" })).toBe("recurring");
    expect(classifyService({ name: "Gym Membership" })).toBe("recurring");
    expect(classifyService({ name: "Storage, Monthly" })).toBe("recurring");
  });

  it("matching is case-insensitive on the name", () => {
    expect(classifyService({ name: "TAXI RIDE" })).toBe("oneoff");
    expect(classifyService({ name: "APARTMENT RENT" })).toBe("recurring");
  });

  it("PRECEDENCE: one-off keywords are checked BEFORE recurring keywords", () => {
    // "PayPhone Call" contains both "phone" (recurring) and "call" (one-off);
    // the deliberate one-off-first ordering makes it a per-use payment.
    expect(classifyService({ name: "PayPhone Call" })).toBe("oneoff");
    // A name with only recurring-ish words stays recurring.
    expect(classifyService({ name: "Cell Phone Plan" })).toBe("recurring");
  });
});

// ─── classifyService: pack / source fallback ──────────────────────────────────

describe("classifyService — pack/source fallback when no keyword matches", () => {
  it("no keyword + no service pack → gear", () => {
    expect(classifyService({ name: "Mystery Widget" })).toBe("gear");
    expect(classifyService({ name: "Mystery Widget" }, "")).toBe("gear");
  });

  it("no keyword + service-ish pack name → oneoff", () => {
    expect(classifyService({ name: "Mystery Widget" }, "Rentals & Services")).toBe("oneoff");
    expect(classifyService({ name: "Mystery Widget" }, "rentalandservices")).toBe("oneoff");
  });

  it("no keyword + service-ish system.source → oneoff", () => {
    expect(classifyService({ name: "Mystery", system: { source: "Rental Listings" } })).toBe("oneoff");
  });

  it("empty item with no pack context → gear", () => {
    expect(classifyService({})).toBe("gear");
    expect(classifyService(null)).toBe("gear");
    expect(classifyService(undefined)).toBe("gear");
  });
});
