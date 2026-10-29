import assert from "node:assert/strict";
import { test } from "node:test";
import { lifecycle, update, validSchedule } from "./nodejs.ts";
import { stamp } from "./versions.ts";

const index = [
  { version: "v27.0.0", date: "2026-10-20", security: false },
  { version: "v26.12.3", date: "2026-10-28", security: false },
  { version: "v26.12.2", date: "2026-10-01", security: true },
  { version: "v26.12.1", date: "2026-09-01", security: false },
  { version: "v26.12.0", date: "2026-08-01", security: false },
];

test("update stays on the major and lets a security release through right away", () => {
  const cutoff = stamp("2026-10-15T00:00:00Z");
  assert.deepEqual(update(index, "26.12.1", cutoff), {
    version: "26.12.2",
    date: "2026-10-01",
    security: true,
  });
  assert.deepEqual(update(index, "26.12.0", stamp("2026-11-30T00:00:00Z")), {
    version: "26.12.3",
    date: "2026-10-28",
    security: true,
  });
  assert.equal(update(index, "26.12.3", cutoff), null);
});

const schedule = {
  v24: {
    start: "2025-05-06",
    lts: "2025-10-28",
    maintenance: "2026-10-20",
    end: "2028-04-30",
  },
  v26: {
    start: "2026-04-21",
    lts: "2026-10-27",
    maintenance: "2027-10-19",
    end: "2029-04-30",
  },
  v22: {
    start: "2024-04-24",
    lts: "2024-10-29",
    maintenance: "2025-10-21",
    end: "2027-04-30",
  },
  v20: {
    start: "2023-04-18",
    lts: "2023-10-24",
    maintenance: "2024-10-22",
    end: "2026-04-30",
  },
};

test("lifecycle names the phase and a newer LTS major", () => {
  assert.deepEqual(lifecycle(schedule, 24, "2026-10-29"), {
    phase: "supported",
    text: "in maintenance, end of life 2028-04-30 · Node.js 26 is Active LTS",
  });
  assert.deepEqual(lifecycle(schedule, 20, "2026-10-29"), {
    phase: "eol",
    text: "end of life since 2026-04-30 · Node.js 26 is Active LTS",
  });
  assert.equal(lifecycle(schedule, 18, "2026-10-29").phase, "unknown");
});

test("validSchedule drops entries whose dates are not plain dates", () => {
  const cleaned = validSchedule({
    ...schedule,
    v28: { start: "2027-04-20", end: "soon" },
    v30: "later",
  });
  assert.deepEqual(Object.keys(cleaned).sort(), ["v20", "v22", "v24", "v26"]);
  assert.deepEqual(cleaned.v26, schedule.v26);
});
