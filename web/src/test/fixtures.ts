// Data as the server sends it, for tests.

export function videoJSON(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    title: "Mare 2024",
    category: "Vacanze",
    duration: 245,
    width: 1920,
    height: 1080,
    cover: "/api/covers/7-0a1b2c3d.jpg",
    addedAt: "2026-10-10T08:00:00Z",
    playable: true,
    ...overrides,
  };
}
