import {
  esc,
  jobMatches,
  labelKey,
  matchedTerms,
  PROFILE_KEY,
  profileMatcher,
  ROLE_BY_LABEL,
  ROLE_IDS,
  ROLES,
  rankJobs,
  searchScore,
  terms,
} from "./search.mjs";

const RTF = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const DEBOUNCE_MS = 150;

const ago = (iso) => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown date";
  return RTF.format(-Math.floor(Math.max(0, Date.now() - t) / 864e5), "day");
};

// Band edges are UTC hours. They only shape the regional dropdowns; "My
// timezone" compares the job's offsets against the reader's own clock.
const REGION_BANDS = {
  americas: [-10, -3],
  emea: [-1, 4],
  apac: [5, 12],
};

const WORLDWIDE_RE = /worldwide|anywhere|global/;

// Offsets are resolved at build time (scripts/timezone.mjs) from the IANA tz
// database, so the browser never maps a place name to a region.
const offsetsOf = (job) => (job.timezoneOffsets?.length ? job.timezoneOffsets : null);
let jobs = [];

function createElements() {
  const p = document.getElementById("p");
  const q = document.getElementById("q");
  const src = document.getElementById("src");
  const geo = document.getElementById("geo");
  const tzTolerance = document.getElementById("tzTolerance");
  const sort = document.getElementById("sort");
  const chips = document.getElementById("chips");
  const list = document.getElementById("list");
  const meta = document.getElementById("meta");
  return { p, q, src, geo, tzTolerance, sort, chips, list, meta };
}

function save(value) {
  try {
    localStorage.setItem(PROFILE_KEY, value);
  } catch {
    // private mode or storage disabled: the page still works, the profile just is not remembered
  }
}

function picked(p) {
  return p.value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function syncChips(p, chips) {
  const activeRoles = new Set();
  for (const s of picked(p)) {
    const id = ROLE_BY_LABEL.get(labelKey(s));
    if (id) activeRoles.add(id);
  }
  for (let i = 0; i < chips.children.length; i++) {
    const b = chips.children[i];
    const roleId = ROLE_IDS[i];
    b.setAttribute("aria-pressed", String(activeRoles.has(roleId)));
  }
}
// biome-ignore lint/correctness/noUnusedFunctionParameters: used via .value
function render({ p, q, src, geo, tzTolerance, sort, chips, list, meta }) {
  const needle = q.value.trim();
  const pick = src.value;
  const geoPick = geo.value;
  const profile = p.value.trim();

  // Detect user's timezone offset in hours (e.g., -5 for EST, +7 for WIB)
  const userOffset = new Date().getTimezoneOffset() / -60;
  // parseInt("") is NaN, so an emptied field falls back to the default instead of 0
  const tolInput = Number.parseInt(tzTolerance?.value ?? "", 10);
  const tolerance = geoPick === "my-tz" && !Number.isNaN(tolInput) ? Math.min(12, Math.max(0, tolInput)) : 2;

  // Show/hide tolerance input
  tzTolerance.style.display = geoPick === "my-tz" ? "inline-block" : "none";

  function geoMatches(job) {
    if (!geoPick) return true;
    const loc = (job.location ?? "").toLowerCase();
    const offsets = offsetsOf(job);

    if (geoPick === "my-tz") {
      // Nothing to rule the job out with: unlabelled, or a label the build could
      // not place ("EMEA-agnostic"). Keeping it is the safe direction.
      if (!offsets) return true;
      return offsets.some((off) => Math.abs(off - userOffset) <= tolerance);
    }

    if (geoPick === "worldwide") return WORLDWIDE_RE.test(loc);
    const band = REGION_BANDS[geoPick];
    if (!band) return true;
    if (!offsets) return false;
    return offsets.some((off) => off >= band[0] && off <= band[1]);
  }

  const matchesProfile = profileMatcher(profile);
  let shown = jobs.filter(
    (j) => (!pick || j.source === pick) && geoMatches(j) && jobMatches(needle, j) && matchesProfile(j),
  );
  const newest = (a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt);
  const ranked = !needle && sort.value === "best" && Boolean(profile);
  if (needle && sort.value === "new") {
    shown.sort(newest);
  } else if (needle) {
    shown.sort((a, b) => searchScore(needle, b) - searchScore(needle, a) || newest(a, b));
  } else if (ranked) {
    const wanted = terms(profile);
    shown = rankJobs(shown, profile).map(({ job }) => ({ ...job, why: matchedTerms(wanted, job) }));
  } else {
    shown.sort(newest);
  }
  const clip = (s) => (s.length > 32 ? `${s.slice(0, 32)}…` : s);
  const suffix = needle
    ? ` · ${sort.value === "new" ? "newest" : "best"} matches for "${clip(needle)}"`
    : ranked
      ? ` · ranked for "${clip(profile)}"`
      : profile
        ? ` · filtered by "${clip(profile)}"`
        : geoPick
          ? ` · filtered by ${geo.options[geo.selectedIndex].text}`
          : "";
  meta.textContent = `${shown.length} of ${jobs.length} remote jobs · ${new Date().toLocaleDateString()}${suffix}`;
  list.innerHTML = shown.length
    ? shown
        .map(
          (j, i) => `<li>
        <span class="num">${i + 1}</span>
        <a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a>
        <div class="sub">${esc(j.company)} · ${esc(j.source)} · ${ago(j.postedAt)}${j.location ? ` · ${esc(j.location)}` : ""}</div>
        ${j.why?.length ? `<div class="why">match: ${esc(j.why.join(" · "))}</div>` : ""}
        <div class="tags">${j.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
      </li>`,
        )
        .join("")
    : `<li class="sub">No matches.</li>`;
}

function initChips(chips) {
  chips.innerHTML = ROLES.map((r) => `<button type="button" class="chip" aria-pressed="false">${esc(r)}</button>`).join(
    "",
  );
}

function debounce(fn, ms) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export async function init() {
  const { p, q, src, geo, tzTolerance, sort, chips, list, meta } = createElements();

  initChips(chips);

  const res = await fetch("./jobs.json");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  jobs = Array.isArray(data) ? data : [];

  for (const s of [...new Set(jobs.map((j) => j.source))].sort()) {
    src.insertAdjacentHTML(
      "beforeend",
      `<option value="${esc(s)}">${esc(s)} (${jobs.filter((j) => j.source === s).length})</option>`,
    );
  }
  if (!jobs.length) {
    meta.textContent = "No jobs published yet — run npm run fetch.";
    return;
  }

  try {
    p.value = localStorage.getItem(PROFILE_KEY) ?? "";
  } catch {
    p.value = "";
  }
  syncChips(p, chips);

  const doRender = () => render({ p, q, src, geo, tzTolerance, sort, chips, list, meta });
  const debouncedRender = debounce(doRender, DEBOUNCE_MS);

  chips.addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    const roleIndex = Array.prototype.indexOf.call(chips.children, b);
    const roleId = ROLE_IDS[roleIndex];
    const rest = picked(p);
    const i = rest.findIndex((s) => ROLE_BY_LABEL.get(labelKey(s)) === roleId);
    if (i >= 0) rest.splice(i, 1);
    else rest.push(b.textContent);
    p.value = rest.join(", ");
    save(p.value);
    syncChips(p, chips);
    doRender();
  });

  p.addEventListener("input", () => {
    save(p.value);
    syncChips(p, chips);
    doRender();
  });

  sort.addEventListener("change", doRender);
  q.addEventListener("input", debouncedRender);
  src.addEventListener("change", doRender);
  geo.addEventListener("change", doRender);
  tzTolerance.addEventListener("change", doRender);

  doRender();
}
