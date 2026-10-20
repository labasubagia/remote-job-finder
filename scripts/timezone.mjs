// Resolve a free-text job location to UTC offsets, using the ICU data already
// shipped with Node (Intl). No data files, no dependencies, no city lists to
// maintain: the zone index is derived from the tz database itself.
//
// Runs at build time (scripts/fetch-jobs.mjs), never in the browser, so the
// published jobs carry plain numbers and the client stays a numeric comparison.

const WORLDWIDE_RE = /\b(worldwide|anywhere|global)\b/;

// Continental shorthand cannot be derived from ICU: a zone knows its city, not
// that it sits in "EMEA". Bounded set, unlike city names.
const CONTINENTS = [
  [/\b(emea)\b/, [0, 1, 2, 3, 4]],
  [/\b(europe|eu)\b/, [0, 1, 2, 3]],
  [/\b(apac|asia|asia[- ]pacific|pacific)\b/, [5, 6, 7, 8, 9, 10, 11, 12]],
  [/\b(oceania|australasia)\b/, [10, 11, 12, 13]],
  [/\b(latam|latin america|south america|central america)\b/, [-5, -4, -3]],
  [/\b(americas|north america)\b/, [-10, -9, -8, -7, -6, -5, -4, -3]],
  [/\b(africa)\b/, [0, 1, 2, 3]],
  [/\b(middle east|mena)\b/, [2, 3, 4]],
];

// Closed set: a job that names a zone abbreviation names one of these.
const ABBREVIATIONS = {
  est: -5,
  edt: -4,
  cst: -6,
  cdt: -5,
  mst: -7,
  mdt: -6,
  pst: -8,
  pdt: -7,
  akst: -9,
  hst: -10,
  bst: 1,
  gmt: 0,
  utc: 0,
  wet: 0,
  west: 1,
  cet: 1,
  cest: 2,
  eet: 2,
  eest: 3,
  msk: 3,
  pkt: 5,
  ist: 5.5,
  ict: 7,
  sgt: 8,
  hkt: 8,
  jst: 9,
  kst: 9,
  acst: 9.5,
  aest: 10,
  aedt: 11,
  awst: 8,
  nzst: 12,
  nzdt: 13,
};

// Country names people actually type instead of the official DisplayNames form.
const ALIASES = { us: "united states", usa: "united states", uk: "united kingdom", uae: "united arab emirates" };

// "U.S." -> "us" (the dot is part of the abbreviation, not a separator) and
// "Zürich" -> "zurich" (the tz database spells it without the umlaut).
const fold = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s*&\s*/g, " and ")
    .replace(/\./g, "")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const offsetCache = new Map();

/** UTC offset in hours for an IANA zone, DST-aware at `now`. */
export function zoneOffset(zone, now = new Date()) {
  const key = `${zone}@${now.toISOString().slice(0, 10)}`;
  if (offsetCache.has(key)) return offsetCache.get(key);
  const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? "");
  const hours = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) + Number(m[3]) / 60) : 0;
  offsetCache.set(key, hours);
  return hours;
}

/** Every 2-letter region code ICU knows a display name for. */
function regionCodes() {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  // "Bosnia & Herzegovina" is published with an ampersand; people type "and".
  const codes = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      const name = names.of(code);
      if (name && name !== code) codes.push({ code, name: fold(name) });
    }
  }
  return codes;
}
// US states are not in the tz database (only their cities are), and "Kansas" or
// "Minnesota" as a whole location is common. Closed set: 50 names, one zone each.
const US_STATES = {
  "America/New_York":
    "connecticut delaware district of columbia florida georgia indiana kentucky maine maryland massachusetts michigan new hampshire new jersey new york north carolina ohio pennsylvania rhode island south carolina vermont virginia west virginia",
  "America/Chicago":
    "alabama arkansas illinois iowa kansas louisiana minnesota mississippi missouri nebraska north dakota oklahoma south dakota tennessee texas wisconsin",
  "America/Denver": "colorado montana new mexico utah wyoming",
  "America/Phoenix": "arizona",
  "America/Los_Angeles": "california nevada oregon washington",
  "America/Boise": "idaho",
  "America/Anchorage": "alaska",
  "Pacific/Honolulu": "hawaii",
};

/**
 * Build the matcher. Returns `(location) => number[] | null`.
 * `null` means "no idea" — callers keep those jobs rather than guess.
 */
export function createLocationResolver({ now = new Date() } = {}) {
  const zones = Intl.supportedValuesOf("timeZone");

  /** @type {Map<string, string[]>} human name -> IANA zones */
  const index = new Map();
  const add = (name, zone) => {
    const key = fold(name);
    if (key.length < 4) return;
    if (index.has(key)) index.get(key).push(zone);
    else index.set(key, [zone]);
  };

  for (const zone of zones) add(zone.split("/").pop().replaceAll("_", " "), zone);
  for (const { name, code } of regionCodes()) {
    for (const zone of new Intl.Locale(`en-${code}`).getTimeZones() ?? []) add(name, zone);
  }
  for (const [zone, states] of Object.entries(US_STATES)) for (const state of states.split(" ")) add(state, zone);
  for (const [alias, name] of Object.entries(ALIASES)) if (index.has(name)) index.set(alias, index.get(name));

  // One alternation over every name, longest first so "san jose" wins over "jose".
  const alternation = [...index.keys()].sort((a, b) => b.length - a.length).join("|");
  const matcher = new RegExp(`\\b(${alternation})\\b`, "g");

  return (location) => {
    const loc = fold(location ?? "");
    if (!loc) return null;

    const offsets = new Set();
    for (const m of loc.matchAll(matcher)) {
      for (const zone of index.get(m[1]) ?? []) offsets.add(zoneOffset(zone, now));
    }
    for (const [re, band] of CONTINENTS) if (band && re.test(loc)) for (const o of band) offsets.add(o);
    for (const [abbr, o] of Object.entries(ABBREVIATIONS)) {
      if (new RegExp(`\\b${abbr}\\b`).test(loc)) offsets.add(o);
    }

    if (!offsets.size) return null;
    return [...offsets].sort((a, b) => a - b);
  };
}

export { WORLDWIDE_RE };
