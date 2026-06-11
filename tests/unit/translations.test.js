/**
 * Unit tests for module/translations.js.
 *
 * Tested:
 *   - getMartialKeyByName — pure given a stubbed
 *     game.i18n.translations.CYBERPUNK.martials map; matches a display name
 *     back to its translation key after normalization (lowercase, strip
 *     "(digits)" parens and "~", normalize ": " spacing, collapse whitespace,
 *     trim).
 *
 * Skipped:
 *   - localize — thin wrapper over game.i18n.format (localization-dependent)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getMartialKeyByName } from "../../module/translations.js";

beforeAll(() => {
  globalThis.game = {
    i18n: {
      translations: {
        CYBERPUNK: {
          martials: {
            karate: "Karate",
            aikido: "Aikido",
            arasakaTe: "Arasaka Te",
          },
        },
      },
    },
  };
});

afterAll(() => {
  delete globalThis.game;
});

describe("getMartialKeyByName", () => {
  it("matches an exact display name", () => {
    expect(getMartialKeyByName("Karate")).toBe("karate");
  });

  it("strips '(digits)' level suffixes before matching", () => {
    expect(getMartialKeyByName("karate(3)")).toBe("karate");
  });

  it("strips tildes and trailing whitespace", () => {
    expect(getMartialKeyByName("Aikido ~")).toBe("aikido");
  });

  it("matches a multi-word display name", () => {
    expect(getMartialKeyByName("Arasaka Te")).toBe("arasakaTe");
  });

  it("collapses internal whitespace", () => {
    expect(getMartialKeyByName("arasaka  te")).toBe("arasakaTe");
  });

  it("returns undefined for an unknown name", () => {
    expect(getMartialKeyByName("Nonexistent")).toBeUndefined();
  });

  it("returns undefined when no translations are loaded", () => {
    const saved = globalThis.game;
    try {
      globalThis.game = {};
      expect(getMartialKeyByName("Karate")).toBeUndefined();
    } finally {
      globalThis.game = saved;
    }
  });
});
