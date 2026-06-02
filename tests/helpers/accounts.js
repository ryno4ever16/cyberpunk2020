/**
 * Test world accounts. All five share the same password on this server.
 *
 * Override the server address with FVTT_URL and the password with FVTT_PASSWORD
 * if the test world is ever moved.
 *
 * Roles (as configured on the server):
 *   - Gamemaster           → GM
 *   - Assistant Gamemaster → Assistant GM (also a GM for permission purposes)
 *   - Test User 1 / 2      → Players
 */
const PASSWORD = process.env.FVTT_PASSWORD || "changeme";

export const ACCOUNTS = {
  gm:        { name: "Gamemaster",           password: PASSWORD, role: "gm" },
  gm2:       { name: "Assistant Gamemaster", password: PASSWORD, role: "gm" },
  player1:   { name: "Test User 1",          password: PASSWORD, role: "player" },
  player2:   { name: "Test User 2",          password: PASSWORD, role: "player" },
  // "Gamemaster 2" per the user's list — kept available if a 2nd full GM is needed.
  gmFull2:   { name: "Gamemaster 2",         password: PASSWORD, role: "gm" },
};
