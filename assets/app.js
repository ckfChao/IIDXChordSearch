const DATA_URLS = {
  metadata: "./assets/song_data.jsonl",
  counts: "./assets/chord_count.csv",
};
const TEXTAGE_SCORE_BASE_URL = "https://textage.cc/score/";

const PATTERN_ORDER = ["S", "1", "2", "3", "4", "5", "6", "7"];
const ALL_PATTERNS = buildAllPatterns(PATTERN_ORDER);
const DEFAULT_REQUIRED_KEYS = new Set(["S", "1", "3"]);
const RADAR_ATTRIBUTES = [
  { key: "NOTES", color: "rgb(255, 64, 235)" },
  { key: "PEAK", color: "rgb(255, 108, 0)" },
  { key: "SCRATCH", color: "rgb(221, 0, 0)" },
  { key: "SOF-LAN", color: "rgb(0, 134, 229)" },
  { key: "CHARGE", color: "rgb(137, 87, 221)" },
  { key: "CHORD", color: "rgb(133, 225, 0)" },
];
const RADAR_MAX_VALUE = 200;

const state = {
  charts: [],
  requiredKeys: new Set(DEFAULT_REQUIRED_KEYS),
  anyKeys: new Set(),
  side: "1p",
  sortMode: "count-desc",
  loaded: false,
  pendingUpdate: 0,
};

const elements = {
  loadState: document.querySelector("#load-state"),
  helpBtn: document.querySelector("#helpBtn"),
  helpOverlay: document.querySelector("#help-overlay"),
  helpDialog: document.querySelector(".help-dialog"),
  helpClose: document.querySelector("#help-close"),
  themeToggle: document.querySelector("#theme-toggle"),
  resultCount: document.querySelector("#result-count"),
  resultLimit: document.querySelector("#result-limit"),
  sortToggle: document.querySelector("#sort-toggle"),
  topButton: document.querySelector("#top-button"),
  results: document.querySelector("#results"),
  clearPattern: document.querySelector("#clear-pattern"),
  patternRow: document.querySelector(".pattern-row"),
  lanes: [...document.querySelectorAll(".lane")],
  sideButtons: [...document.querySelectorAll(".side-button")],
  difficultyButtons: [...document.querySelectorAll(".difficulty-button")],
  radarButtons: [...document.querySelectorAll(".radar-button")],
  filters: document.querySelector("#filters"),
  artist: document.querySelector("#artist-filter"),
  levelMin: document.querySelector("#level-min"),
  levelMax: document.querySelector("#level-max"),
  bpmMin: document.querySelector("#bpm-min"),
  bpmMax: document.querySelector("#bpm-max"),
};

init();

async function init() {
  initTheme();
  bindEvents();
  syncSideUI();
  syncPatternUI();
  syncSortUI();

  try {
    elements.loadState.textContent = "Loading chart data...";
    const [metadataFile, countFile] = await Promise.all([
      fetchText(DATA_URLS.metadata),
      fetchText(DATA_URLS.counts),
    ]);

    const metadata = parseJsonLines(metadataFile.text);
    const countRows = parseCsv(countFile.text);
    state.charts = joinCharts(metadata, countRows);
    state.loaded = true;
    elements.loadState.textContent = formatLastUpdated(metadataFile.lastModified);
    updateResults();
  } catch (error) {
    console.error(error);
    elements.loadState.textContent = "Failed to load data";
    elements.results.innerHTML = `
      <div class="empty">
        Could not load ./assets/song_data.jsonl and ./assets/chord_count.csv.
        Serve this repository directory with a local web server.
      </div>
    `;
  }
}

function bindEvents() {
  elements.helpBtn.addEventListener("click", openHelp);
  elements.helpClose.addEventListener("click", closeHelp);
  elements.helpOverlay.addEventListener("click", (event) => {
    if (event.target === elements.helpOverlay) closeHelp();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.helpOverlay.hidden) closeHelp();
  });

  elements.themeToggle.addEventListener("click", () => {
    const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    saveTheme(nextTheme);
  });

  for (const button of elements.sideButtons) {
    button.addEventListener("click", () => {
      state.side = button.dataset.side;
      syncSideUI();
      syncPatternUI();
      scheduleUpdateResults();
    });
  }

  for (const lane of elements.lanes) {
    lane.addEventListener("click", () => {
      cyclePatternKey(lane.dataset.lane);
      syncPatternUI();
      scheduleUpdateResults();
    });
  }

  elements.clearPattern.addEventListener("click", () => {
    state.requiredKeys.clear();
    state.anyKeys.clear();
    syncPatternUI();
    scheduleUpdateResults();
  });

  for (const button of elements.difficultyButtons) {
    button.addEventListener("click", () => {
      const active = !button.classList.contains("active");
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      scheduleUpdateResults();
    });
  }

  for (const button of elements.radarButtons) {
    button.addEventListener("click", () => {
      const active = !button.classList.contains("active");
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      scheduleUpdateResults();
    });
  }

  elements.filters.addEventListener("input", scheduleUpdateResults);
  elements.filters.addEventListener("change", scheduleUpdateResults);
  elements.resultLimit.addEventListener("change", updateResults);
  elements.sortToggle.addEventListener("click", () => {
    state.sortMode = state.sortMode === "count-desc" ? "count-asc" : "count-desc";
    syncSortUI();
    updateResults();
  });

  elements.topButton.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  window.addEventListener("scroll", syncTopButton, { passive: true });
  syncTopButton();
}

function openHelp() {
  elements.helpOverlay.hidden = false;
  document.body.classList.add("modal-open");
  elements.helpDialog.focus();
}

function closeHelp() {
  elements.helpOverlay.hidden = true;
  document.body.classList.remove("modal-open");
  elements.helpBtn.focus();
}

function syncTopButton() {
  const visible = window.scrollY > 420;
  elements.topButton.classList.toggle("visible", visible);
}

function initTheme() {
  applyTheme(loadTheme());
}

function loadTheme() {
  try {
    const savedTheme = localStorage.getItem("chord-search-theme");
    if (savedTheme === "dark" || savedTheme === "light") return savedTheme;
  } catch (error) {
    // Ignore storage restrictions and fall back to light mode.
  }
  return "light";
}

function saveTheme(theme) {
  try {
    localStorage.setItem("chord-search-theme", theme);
  } catch (error) {
    // Theme still applies for this session when storage is unavailable.
  }
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.body.dataset.theme = isDark ? "dark" : "light";
  elements.themeToggle.textContent = isDark ? "Light" : "Dark";
  elements.themeToggle.setAttribute("aria-pressed", String(isDark));
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  return {
    text: await response.text(),
    lastModified: response.headers.get("Last-Modified"),
  };
}

function formatLastUpdated(lastModified) {
  const date = new Date(lastModified);
  if (!lastModified || Number.isNaN(date.getTime())) return "Last updated unknown";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `Last updated ${year}/${month}/${day}`;
}

function parseJsonLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  const [headers, ...body] = rows;
  return body
    .filter((items) => items.length && items[0] !== "")
    .map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] ?? ""])));
}

function buildAllPatterns(keys) {
  const patterns = [];
  const totalMasks = 2 ** keys.length;

  for (let mask = 1; mask < totalMasks; mask += 1) {
    const pattern = keys.filter((_, index) => mask & (1 << index)).join("");
    patterns.push(pattern);
  }

  return patterns;
}

function joinCharts(metadataRows, countRows) {
  const countsById = new Map(countRows.map((row) => [String(row.id), normalizeCountRow(row)]));
  return metadataRows
    .map((meta) => prepareChart(meta, countsById.get(String(meta.id))))
    .filter((chart) => chart.counts.id !== undefined);
}

function normalizeCountRow(row) {
  const counts = { id: row.id };
  for (const [key, value] of Object.entries(row)) {
    if (key !== "id") counts[key] = Number(value) || 0;
  }
  return counts;
}

function prepareChart(meta, counts = {}) {
  const bpmRange = parseBpmRange(meta.bpm);
  const radar = prepareRadar(meta);
  const title = decodeHtmlEntities(meta.title);
  const artist = decodeHtmlEntities(meta.artist);
  const genre = decodeHtmlEntities(meta.genre);

  return {
    ...meta,
    title,
    artist,
    genre,
    counts,
    levelNumber: parseNumeric(meta.level),
    bpmMin: bpmRange.min,
    bpmMax: bpmRange.max,
    normalizedArtist: normalize(artist),
    normalizedDifficulty: normalizeDifficulty(meta.opt),
    difficultyClass: difficultyColorClass(meta.opt),
    chartUrl1p: urlForSide(meta.url, "1p"),
    chartUrl2p: urlForSide(meta.url, "2p"),
    titleHtml: escapeHtml(title),
    displayLevelHtml: escapeHtml(meta.level || "?"),
    displayBpmHtml: escapeHtml(meta.bpm || "?"),
    displayGenreHtml: escapeHtml(genre || "Unknown genre"),
    displayArtistHtml: escapeHtml(artist || "Unknown artist"),
    radar,
  };
}

function prepareRadar(chart) {
  const hasMissingValue = RADAR_ATTRIBUTES.some((attr) => isMissingRadarValue(chart[attr.key]));
  const values = hasMissingValue
    ? RADAR_ATTRIBUTES.map(() => 0)
    : RADAR_ATTRIBUTES.map((attr) => radarValue(chart[attr.key]));
  const dominantIndex = values.reduce(
    (bestIndex, value, index) => (value > values[bestIndex] ? index : bestIndex),
    0,
  );

  return {
    values,
    hasMissingValue,
    dominantKey: hasMissingValue ? null : RADAR_ATTRIBUTES[dominantIndex].key,
    plotColor: hasMissingValue
      ? "rgb(139, 146, 140)"
      : values[dominantIndex] > 0
      ? RADAR_ATTRIBUTES[dominantIndex].color
      : "rgb(86, 97, 92)",
    html: "",
  };
}

function syncSideUI() {
  const order = state.side === "2p"
    ? ["1", "2", "3", "4", "5", "6", "7", "S"]
    : ["S", "1", "2", "3", "4", "5", "6", "7"];

  elements.patternRow.classList.toggle("side-1p", state.side === "1p");
  elements.patternRow.classList.toggle("side-2p", state.side === "2p");

  for (const laneValue of order) {
    const lane = elements.lanes.find((item) => item.dataset.lane === laneValue);
    if (lane) elements.patternRow.append(lane);
  }

  for (const button of elements.sideButtons) {
    const active = button.dataset.side === state.side;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function syncPatternUI() {
  for (const lane of elements.lanes) {
    const laneValue = lane.dataset.lane;
    const required = state.requiredKeys.has(laneValue);
    const any = state.anyKeys.has(laneValue);
    const stateLabel = required ? "required" : any ? "any" : "off";

    lane.classList.toggle("selected", required);
    lane.classList.toggle("required", required);
    lane.classList.toggle("any", any);
    lane.dataset.state = stateLabel;
    lane.setAttribute("aria-pressed", required ? "true" : any ? "mixed" : "false");
    lane.setAttribute("aria-label", `${laneValue} ${stateLabel}`);
  }
}

function cyclePatternKey(laneValue) {
  if (state.requiredKeys.has(laneValue)) {
    state.requiredKeys.delete(laneValue);
    state.anyKeys.add(laneValue);
    return;
  }

  if (state.anyKeys.has(laneValue)) {
    state.anyKeys.delete(laneValue);
    return;
  }

  state.requiredKeys.add(laneValue);
}

function hasActivePatternKeys() {
  return state.requiredKeys.size > 0 || state.anyKeys.size > 0;
}

function getMatchingPatterns() {
  return ALL_PATTERNS.filter((pattern) => patternMatchesSelector(pattern));
}

function patternMatchesSelector(pattern) {
  for (const lane of PATTERN_ORDER) {
    const hasLane = pattern.includes(lane);
    if (state.requiredKeys.has(lane)) {
      if (!hasLane) return false;
    } else if (!state.anyKeys.has(lane) && hasLane) {
      return false;
    }
  }

  return true;
}

function getDisplayPattern() {
  const order = state.side === "2p"
    ? ["1", "2", "3", "4", "5", "6", "7", "S"]
    : ["S", "1", "2", "3", "4", "5", "6", "7"];
  const required = order.filter((lane) => state.requiredKeys.has(lane)).join("");
  const any = order.filter((lane) => state.anyKeys.has(lane)).join("");

  if (required && any) return `${required} · any ${any}`;
  if (required) return required;
  return `any ${any}`;
}

function updateResults() {
  if (!state.loaded) return;

  if (!hasActivePatternKeys()) {
    elements.resultCount.textContent = "0 charts";
    renderSelectPatternPrompt();
    return;
  }

  const matchingPatterns = getMatchingPatterns();
  const displayPattern = getDisplayPattern();
  const filters = readFilters();
  const matches = [];

  for (const chart of state.charts) {
    const count = sumPatternCounts(chart.counts, matchingPatterns);
    if (count === 0 || !matchesFilters(chart, filters)) continue;
    matches.push({ chart, count });
  }

  matches.sort((a, b) => compareResults(a, b, filters.sortMode));

  elements.resultCount.textContent = `${matches.length.toLocaleString()} charts`;
  const visibleMatches = limitResults(matches, elements.resultLimit.value);
  renderResults(visibleMatches, matches.length, displayPattern);
}

function renderSelectPatternPrompt() {
  elements.results.innerHTML = `
    <div class="empty">Select at least one key to search chord patterns.</div>
  `;
}

function sumPatternCounts(counts, patterns) {
  let total = 0;
  for (const pattern of patterns) {
    total += counts[pattern] || 0;
  }
  return total;
}

function scheduleUpdateResults() {
  if (state.pendingUpdate) cancelAnimationFrame(state.pendingUpdate);
  state.pendingUpdate = requestAnimationFrame(() => {
    state.pendingUpdate = 0;
    updateResults();
  });
}

function readFilters() {
  const radarAttributes = elements.radarButtons
    .filter((button) => button.classList.contains("active"))
    .map((button) => button.dataset.radar);

  return {
    artist: normalize(elements.artist.value),
    difficulties: new Set(elements.difficultyButtons
      .filter((button) => button.classList.contains("active"))
      .map((button) => button.dataset.difficulty)),
    radarAttributes: new Set(radarAttributes),
    hasRadarFilter: radarAttributes.length !== RADAR_ATTRIBUTES.length,
    levelMin: parseNumeric(elements.levelMin.value),
    levelMax: parseNumeric(elements.levelMax.value),
    bpmMin: parseNumeric(elements.bpmMin.value),
    bpmMax: parseNumeric(elements.bpmMax.value),
    sortMode: state.sortMode,
  };
}

function compareResults(a, b, sortMode) {
  if (sortMode === "count-asc") return a.count - b.count;
  return b.count - a.count;
}

function limitResults(matches, limitValue) {
  if (limitValue === "all") return matches;
  const limit = Number.parseInt(limitValue, 10);
  return matches.slice(0, Number.isFinite(limit) ? limit : 50);
}

function syncSortUI() {
  const isAscending = state.sortMode === "count-asc";
  const label = isAscending ? "Sort count low to high" : "Sort count high to low";
  elements.sortToggle.querySelector(".sort-icon").textContent = isAscending ? "↑" : "↓";
  elements.sortToggle.setAttribute("aria-label", label);
  elements.sortToggle.setAttribute("title", label);
}

function matchesFilters(chart, filters) {
  if (filters.artist && !chart.normalizedArtist.includes(filters.artist)) return false;
  if (!filters.difficulties.has(chart.normalizedDifficulty)) return false;

  if (filters.levelMin !== null && (chart.levelNumber === null || chart.levelNumber < filters.levelMin)) {
    return false;
  }
  if (filters.levelMax !== null && (chart.levelNumber === null || chart.levelNumber > filters.levelMax)) {
    return false;
  }
  if (filters.bpmMin !== null && chart.bpmMax < filters.bpmMin) return false;
  if (filters.bpmMax !== null && chart.bpmMin > filters.bpmMax) return false;
  if (filters.hasRadarFilter && !matchesRadarFilter(chart, filters.radarAttributes)) return false;

  return true;
}

function matchesRadarFilter(chart, selectedAttributes) {
  if (chart.radar.dominantKey === null) return true;
  if (!selectedAttributes.size) return false;
  return selectedAttributes.has(chart.radar.dominantKey);
}

function renderResults(items, total, pattern) {
  if (!items.length) {
    elements.results.innerHTML = `<div class="empty">No charts found for ${escapeHtml(pattern)}.</div>`;
    return;
  }

  const suffix = total > items.length
    ? `<div class="empty">Showing top ${items.length.toLocaleString()} of ${total.toLocaleString()} matches.</div>`
    : "";

  elements.results.innerHTML = items.map(({ chart, count }) => resultCard(chart, count)).join("") + suffix;
}

function resultCard(chart, count) {
  const chartUrl = state.side === "2p" ? chart.chartUrl2p : chart.chartUrl1p;

  return `
    <article class="result-card">
      ${radarChart(chart)}
      <div class="result-main">
        <a class="song-title" href="${escapeAttribute(chartUrl)}" target="_blank" rel="noreferrer">
          ${chart.titleHtml}
        </a>
        <div class="meta">
          <span class="pill level-pill ${chart.difficultyClass}">Lv ${chart.displayLevelHtml}</span>
          <span class="pill">BPM ${chart.displayBpmHtml}</span>
          <span class="pill">${chart.displayGenreHtml}</span>
        </div>
        <div class="artist-line">${chart.displayArtistHtml}</div>
      </div>
      <div class="count-box" aria-label="Pattern count">
        <strong>${count.toLocaleString()}</strong>
        <span>count</span>
      </div>
    </article>
  `;
}

function radarChart(chart) {
  if (chart.radar.html) return chart.radar.html;

  const size = 160;
  const center = size / 2;
  const radius = 36;
  const { values, hasMissingValue, plotColor } = chart.radar;
  const outerPoints = RADAR_ATTRIBUTES.map((_, index) => radarPoint(index, radius, center));
  const midPoints = RADAR_ATTRIBUTES.map((_, index) => radarPoint(index, radius * 0.5, center));
  const plotPoints = values.map((value, index) => {
    const scaledRadius = radius * Math.min(value, RADAR_MAX_VALUE) / RADAR_MAX_VALUE;
    return radarPoint(index, scaledRadius, center);
  });
  const spokes = outerPoints
    .map((point) => `<line x1="${center}" y1="${center}" x2="${point.x}" y2="${point.y}" />`)
    .join("");
  const labels = RADAR_ATTRIBUTES
    .map((attr, index) => radarLabel(attr, index, center, radius, hasMissingValue))
    .join("");
  const ariaLabel = RADAR_ATTRIBUTES
    .map((attr, index) => `${attr.key} ${hasMissingValue ? "unknown" : values[index]}`)
    .join(", ");
  const missingMark = hasMissingValue
    ? `
        <g class="radar-missing-mark" aria-hidden="true">
          <circle cx="${center}" cy="${center}" r="15" />
          <text x="${center}" y="${center}" text-anchor="middle" dominant-baseline="central">?</text>
        </g>
      `
    : "";

  chart.radar.html = `
    <div class="radar-wrap ${hasMissingValue ? "radar-missing" : ""}" aria-label="${escapeAttribute(ariaLabel)}">
      <svg class="notes-radar" viewBox="0 0 ${size} ${size}" role="img">
        <polygon class="radar-grid radar-grid-outer" points="${pointsToString(outerPoints)}" />
        <polygon class="radar-grid radar-grid-mid" points="${pointsToString(midPoints)}" />
        <g class="radar-spokes">${spokes}</g>
        <polygon
          class="radar-plot"
          points="${pointsToString(plotPoints)}"
          style="--radar-color: ${plotColor}"
        />
        <polygon class="radar-outline" points="${pointsToString(plotPoints)}" />
        ${missingMark}
        ${labels}
      </svg>
    </div>
  `;
  return chart.radar.html;
}

function isMissingRadarValue(value) {
  return Number(value) === -1;
}

function radarValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(number, RADAR_MAX_VALUE);
}

function radarPoint(index, radius, center) {
  const angle = -Math.PI / 2 + index * (Math.PI * 2 / RADAR_ATTRIBUTES.length);
  return {
    x: roundSvg(center + Math.cos(angle) * radius),
    y: roundSvg(center + Math.sin(angle) * radius),
  };
}

function radarLabel(attr, index, center, radius, useMissingColor) {
  const point = radarPoint(index, radius + 14, center);
  const anchor = index === 0 || index === 3 ? "middle" : index < 3 ? "start" : "end";
  const dx = index === 1 || index === 2 ? "-0.25em" : index === 4 || index === 5 ? "0.25em" : "0";
  const dy = index === 0 ? "0.1em" : index === 3 ? "0.4em" : "0.35em";
  const labelColor = useMissingColor ? "rgb(139, 146, 140)" : attr.color;

  return `
    <text
      class="radar-label"
      x="${point.x}"
      y="${point.y}"
      dx="${dx}"
      dy="${dy}"
      text-anchor="${anchor}"
      style="--label-color: ${labelColor}"
    >${escapeHtml(attr.key)}</text>
  `;
}

function pointsToString(points) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function roundSvg(value) {
  return Number(value.toFixed(2));
}

function urlForSide(url, side) {
  const sideNumber = side === "2p" ? "2" : "1";
  const sideUrl = String(url || "").replace(/([?&])[12]([XAHNP])/i, `$1${sideNumber}$2`);
  return new URL(sideUrl, TEXTAGE_SCORE_BASE_URL).href;
}

function parseNumeric(value) {
  if (value === null || value === undefined || value === "" || value === "?") return null;
  const number = Number.parseInt(String(value), 10);
  return Number.isFinite(number) ? number : null;
}

function parseBpmRange(value) {
  const numbers = String(value || "").match(/\d+/g)?.map(Number) || [];
  if (!numbers.length) return { min: 0, max: Number.POSITIVE_INFINITY };
  return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function decodeHtmlEntities(value) {
  const text = String(value ?? "");
  if (!text.includes("&")) return text;

  const textarea = decodeHtmlEntities.textarea || document.createElement("textarea");
  decodeHtmlEntities.textarea = textarea;
  textarea.innerHTML = text;
  return textarea.value;
}

function normalizeDifficulty(value) {
  const text = String(value || "").toUpperCase();
  if (text.includes("LEGGENDARIA")) return "LEGGENDARIA";
  if (text.includes("ANOTHER")) return "ANOTHER";
  if (text.includes("HYPER")) return "HYPER";
  if (text.includes("NORMAL")) return "NORMAL";
  return text;
}

function difficultyColorClass(value) {
  const difficulty = normalizeDifficulty(value);
  if (difficulty === "LEGGENDARIA") return "diff-spl";
  if (difficulty === "ANOTHER") return "diff-spa";
  if (difficulty === "HYPER") return "diff-sph";
  if (difficulty === "NORMAL") return "diff-spn";
  return "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
