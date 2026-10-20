import assert from "node:assert/strict";
import test from "node:test";
import { createLocationResolver, zoneOffset } from "../scripts/timezone.mjs";

// Pin one date so the assertions describe a fixed set of DST offsets.
const JULY = new Date("2026-07-15T12:00:00Z");
const resolver = createLocationResolver({ now: JULY });

const near = (actual, expected) => Math.abs(actual - expected) < 1e-9;

const offsetsFor = (location) => {
  const offsets = resolver(location);
  assert.ok(offsets, `expected ${location} to resolve, got null`);
  return offsets;
};

test("IANA city names resolve without any lookup table", () => {
  assert.deepEqual(offsetsFor("Copenhagen"), [2]);
  assert.deepEqual(offsetsFor("Vancouver"), [-7]);
  assert.deepEqual(offsetsFor("Jakarta"), [7]);
  assert.deepEqual(offsetsFor("Melbourne"), [10]);
  assert.deepEqual(offsetsFor("Helsinki"), [3]);
});

test("a city inside a longer label still resolves", () => {
  assert.ok(offsetsFor("Berlin, Germany").includes(2));
  assert.ok(offsetsFor("Remote - Lisbon (Portugal)").includes(1));
});

test("country names resolve to every zone in that country", () => {
  const us = offsetsFor("United States");
  assert.ok(us.includes(-10) && us.includes(-5), `US spans -10..-5, got ${us}`);
  assert.deepEqual(offsetsFor("Japan"), [9]);
  assert.deepEqual(offsetsFor("Germany"), [2]);
});

test("the ampersand form and common abbreviations are accepted", () => {
  assert.deepEqual(offsetsFor("Bosnia And Herzegovina"), offsetsFor("Bosnia & Herzegovina"));
  assert.deepEqual(offsetsFor("Remote from the US"), offsetsFor("United States"));
  assert.deepEqual(offsetsFor("Remote (UK)"), [1]);
});

test("US states resolve even though the tz database only knows cities", () => {
  assert.ok(offsetsFor("Kansas").includes(-5));
  assert.ok(offsetsFor("Sterling Heights, Michigan").includes(-4));
  assert.ok(offsetsFor("Minnesota").includes(-5));
});

test("zone abbreviations are understood", () => {
  assert.deepEqual(offsetsFor("NYC or Remote (EST or CST)"), [-6, -5]);
  assert.deepEqual(offsetsFor("Remote (CET)"), [1]);
});

test("continents expand to their band", () => {
  assert.deepEqual(offsetsFor("Europe"), [0, 1, 2, 3]);
  assert.ok(offsetsFor("APAC").includes(12));
  assert.ok(offsetsFor("LATAM").includes(-3));
});

test("a multi-region label carries the union, so any of them keeps the job", () => {
  const offsets = offsetsFor("Europe, LATAM, APAC, the U.S., Canada");
  assert.ok(offsets.includes(2) && offsets.includes(-7) && offsets.includes(9));
});

test("labels that name no place stay unresolved instead of guessing", () => {
  for (const label of ["Remote", "Remote job", "Poste à distance", "Werken op afstand", "", null, undefined]) {
    assert.equal(resolver(label), null, `${label} should resolve to null`);
  }
});

test("offsets follow daylight saving time", () => {
  const winter = createLocationResolver({ now: new Date("2026-01-15T12:00:00Z") });
  assert.deepEqual(winter("Berlin"), [1]);
  assert.deepEqual(winter("New York"), [-5]);
  assert.equal(zoneOffset("Europe/Berlin", JULY), 2);
  assert.equal(zoneOffset("Europe/Berlin", new Date("2026-01-15T12:00:00Z")), 1);
});

test("the resolver is fast enough to run on every job", () => {
  const started = performance.now();
  for (let i = 0; i < 300; i++) resolver("Copenhagen, Denmark");
  assert.ok(performance.now() - started < 500, "300 lookups should stay well under half a second");
  assert.ok(near(zoneOffset("UTC", JULY), 0));
});
