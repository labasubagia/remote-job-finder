import { esc, jobMatches, matchedTerms, PROFILE_KEY, ROLES, rankJobs, searchScore, terms } from "./search.mjs";

const RTF = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const DEBOUNCE_MS = 150;

const ago = (iso) => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown date";
  return RTF.format(-Math.floor(Math.max(0, Date.now() - t) / 864e5), "day");
};

let jobs = [];

function createElements() {
  const p = document.getElementById("p");
  const q = document.getElementById("q");
  const src = document.getElementById("src");
  const sort = document.getElementById("sort");
  const chips = document.getElementById("chips");
  const list = document.getElementById("list");
  const meta = document.getElementById("meta");
  return { p, q, src, sort, chips, list, meta };
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
  const on = new Set(picked(p).map((s) => s.toLowerCase()));
  for (const b of chips.children) b.setAttribute("aria-pressed", String(on.has(b.textContent.toLowerCase())));
}
// biome-ignore lint/correctness/noUnusedFunctionParameters: used via .value
function render({ p, q, src, sort, chips, list, meta }) {
  const needle = q.value.trim();
  const pick = src.value;
  const profile = p.value.trim();
  let shown = jobs.filter((j) => (!pick || j.source === pick) && jobMatches(needle, j));
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
      : "";
  meta.textContent = `${shown.length} of ${jobs.length} remote jobs · ${new Date().toLocaleDateString()}${suffix}`;
  list.innerHTML = shown.length
    ? shown
        .map(
          (j, i) => `<li>
        <span class="num">${i + 1}</span>
        <a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a>
        <div class="sub">${esc(j.company)} · ${esc(j.source)} · ${ago(j.postedAt)}</div>
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
  const { p, q, src, sort, chips, list, meta } = createElements();

  initChips(chips);

  const res = await fetch("./jobs.json");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  jobs = Array.isArray(await res.json()) ? jobs : [];

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

  const doRender = () => render({ p, q, src, sort, chips, list, meta });
  const debouncedRender = debounce(doRender, DEBOUNCE_MS);

  chips.addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    const rest = picked(p);
    const i = rest.findIndex((s) => s.toLowerCase() === b.textContent.toLowerCase());
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

  doRender();
}
