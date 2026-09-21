import * as maplibregl from "https://unpkg.com/maplibre-gl@6.10.0/dist/maplibre-gl.mjs";

const NORTH_AMERICA_HOME = { center: [-105, 45], zoom: 2.15 };
const DEFAULT_REACH_ID = "74210000331";
const HYDROCRON_URL = "https://soto.podaac.earthdatacloud.nasa.gov/hydrocron/v1/timeseries";
const DISCHARGE_SERIES = [
  { key: "consensus", field: "sos_consensus_q", label: "Consensus", color: "#087bf1" },
  { key: "hivdi", field: "sos_hivdi_q", label: "HiVDI", color: "#8b5cf6" },
  { key: "metroman", field: "sos_metroman_q", label: "MetroMan", color: "#ef4444" },
  { key: "momma", field: "sos_momma_q", label: "MOMMA", color: "#ec4899" },
  { key: "sad", field: "sos_sad_q", label: "SAD", color: "#f59e0b" },
  { key: "sic4dvar", field: "sos_sic4dvar_q", label: "SIC4DVar", color: "#10a878" },
  { key: "lakeflow", field: "sos_lakeflow_q", label: "LakeFlow", color: "#06b6d4" },
];
const HYDROCRON_FIELDS = [
  "reach_id",
  "time_str",
  "sos_consensus_q",
  "sos_hivdi_q",
  "sos_metroman_q",
  "sos_momma_q",
  "sos_sad_q",
  "sos_sic4dvar_q",
  "sos_lakeflow_q",
  "swot_discharge_reanalysis",
].join(",");
const RIVER_SOURCE = "north-america-rivers";
const RIVER_LAYER = "river-lines";
const RIVER_HIT_LAYER = "river-hit-area";
const BASE_LAYERS = ["satellite-base", "terrain-base", "light-base"];

const els = {
  startDate: document.querySelector("#start-date"),
  endDate: document.querySelector("#end-date"),
  dateError: document.querySelector("#date-error"),
  resetMap: document.querySelector("#reset-map"),
  reachCount: document.querySelector("#reach-count"),
  mapLoading: document.querySelector("#map-loading"),
  mapTooltip: document.querySelector("#map-tooltip"),
  reachEmpty: document.querySelector("#reach-empty"),
  reachDetails: document.querySelector("#reach-details"),
  riverName: document.querySelector("#river-name"),
  widthChip: document.querySelector("#width-chip"),
  reachId: document.querySelector("#reach-id"),
  reachWse: document.querySelector("#reach-wse"),
  reachWidth: document.querySelector("#reach-width"),
  reachSlope: document.querySelector("#reach-slope"),
  reachDistance: document.querySelector("#reach-distance"),
  selectedPeriod: document.querySelector("#selected-period"),
  reachMessage: document.querySelector("#reach-message"),
  chartSubtitle: document.querySelector("#chart-subtitle"),
  chartStatus: document.querySelector("#chart-status"),
  chartWrap: document.querySelector("#chart-wrap"),
  chartEmpty: document.querySelector("#chart-empty"),
  chartTooltip: document.querySelector("#chart-tooltip"),
  statMin: document.querySelector("#stat-min"),
  statMax: document.querySelector("#stat-max"),
  statMedian: document.querySelector("#stat-median"),
  statStd: document.querySelector("#stat-std"),
  downloadButton: document.querySelector("#download-button"),
};

let map;
let crosswalk = {};
let selectedFeatureId = null;
let hoveredFeatureId = null;
let selectedProperties = null;
let activeRequest = null;
let latestDownload = null;
const dischargeCache = new Map();

setDefaultDates();

const settingsDetails = document.querySelector(".settings-details");
if (window.matchMedia("(max-width: 620px)").matches) settingsDetails.open = false;

const mapStyle = {
  version: 8,
  sources: {
    satellite: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Tiles © Esri and contributors",
    },
    terrain: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Tiles © Esri and contributors",
    },
    light: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 512,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [
    { id: "satellite-base", type: "raster", source: "satellite" },
    { id: "terrain-base", type: "raster", source: "terrain", layout: { visibility: "none" } },
    { id: "light-base", type: "raster", source: "light", layout: { visibility: "none" } },
  ],
};

map = new maplibregl.Map({
  container: "map",
  style: mapStyle,
  center: NORTH_AMERICA_HOME.center,
  zoom: NORTH_AMERICA_HOME.zoom,
  minZoom: 1.8,
  maxZoom: 13,
  attributionControl: false,
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false,
});

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-left");
map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

map.once("load", loadRiverNetwork);

document.querySelectorAll('input[name="map-style"]').forEach((input) => {
  input.addEventListener("change", (event) => setBaseMap(event.target.value));
});

els.resetMap.addEventListener("click", () => {
  map.easeTo({ ...NORTH_AMERICA_HOME, duration: 750 });
  clearSelection();
});

[els.startDate, els.endDate].forEach((input) => {
  const dateField = input.closest(".date-row label");
  dateField.addEventListener("pointerdown", (event) => {
    if (typeof input.showPicker !== "function") return;
    try {
      input.showPicker();
      event.preventDefault();
    } catch {
      // Keep the browser's standard date control usable when showPicker is unavailable.
    }
  });

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (typeof input.showPicker !== "function") return;
    try {
      input.showPicker();
      event.preventDefault();
    } catch {
      // Keyboard users can still use the browser's native date control.
    }
  });

  input.addEventListener("change", () => {
    if (!datesAreValid()) return;
    if (selectedProperties) {
      els.selectedPeriod.textContent = `${els.startDate.value} to ${els.endDate.value}`;
      loadDischarge(selectedProperties.reach_id);
    }
  });
});

document.querySelectorAll("[data-dialog]").forEach((button) => {
  button.addEventListener("click", () => document.querySelector(`#${button.dataset.dialog}`)?.showModal());
});

document.querySelectorAll(".dialog-close").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog")?.close());
});

els.downloadButton.addEventListener("click", downloadSelectedSeries);

async function loadRiverNetwork() {
  try {
    const [networkResponse, crosswalkResponse] = await Promise.all([
      fetch("./data/reaches.geojson"),
      fetch("./data/reach-v16.json"),
    ]);

    if (!networkResponse.ok || !crosswalkResponse.ok) {
      throw new Error("The river data files could not be loaded.");
    }

    const [network, lookup] = await Promise.all([
      networkResponse.json(),
      crosswalkResponse.json(),
    ]);

    crosswalk = lookup;
    map.addSource(RIVER_SOURCE, {
      type: "geojson",
      data: network,
      promoteId: "reach_id",
    });

    map.addLayer({
      id: RIVER_LAYER,
      type: "line",
      source: RIVER_SOURCE,
      paint: {
        "line-color": riverColorExpression(),
        "line-width": riverLineWidthExpression(),
        "line-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 1, 0.88],
      },
    });

    map.addLayer({
      id: "river-hover",
      type: "line",
      source: RIVER_SOURCE,
      paint: {
        "line-color": "#ffffff",
        "line-width": riverLineWidthExpression(1.5),
        "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.72, 0],
      },
    });

    map.addLayer({
      id: "river-selected",
      type: "line",
      source: RIVER_SOURCE,
      paint: {
        "line-color": "#ffffff",
        "line-width": riverLineWidthExpression(3),
        "line-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 1, 0],
        "line-blur": 0.3,
      },
    });

    map.addLayer({
      id: RIVER_HIT_LAYER,
      type: "line",
      source: RIVER_SOURCE,
      paint: {
        "line-color": "rgba(0,0,0,0)",
        "line-width": riverLineWidthExpression(8),
      },
    });

    bindMapInteractions();
    els.reachCount.textContent = `${network.features.length.toLocaleString()} river reaches`;
    els.mapLoading.classList.add("hidden");
    focusDefaultReach(network);
  } catch (error) {
    els.mapLoading.innerHTML = `<span>River network unavailable. ${escapeHtml(error.message)}</span>`;
    els.reachCount.textContent = "River network unavailable";
  }
}

function focusDefaultReach(network) {
  const feature = network.features.find((item) => String(item.properties?.reach_id) === DEFAULT_REACH_ID);
  if (!feature) {
    map.jumpTo(NORTH_AMERICA_HOME);
    return;
  }

  const coordinates = feature.geometry?.type === "MultiLineString"
    ? feature.geometry.coordinates.flat()
    : feature.geometry?.coordinates ?? [];
  const bounds = coordinates.reduce(
    (result, coordinate) => result.extend(coordinate),
    new maplibregl.LngLatBounds(),
  );
  const mapWidth = map.getContainer().clientWidth;

  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, {
      padding: {
        top: 90,
        right: 110,
        bottom: 90,
        left: Math.min(500, Math.round(mapWidth * 0.4)),
      },
      maxZoom: 9,
      duration: 0,
    });
  }

  selectReach({ id: DEFAULT_REACH_ID, properties: feature.properties });
}

function riverLineWidthExpression(extraWidth = 0) {
  const riverWidth = ["max", 1, ["to-number", ["get", "width"], 1]];
  const widthAtScale = (scale) => [
    "case",
    ["<", riverWidth, 50], (1.6 * scale) + extraWidth,
    ["<", riverWidth, 150], (2.3 * scale) + extraWidth,
    ["<", riverWidth, 500], (3.2 * scale) + extraWidth,
    ["<=", riverWidth, 1500], (4.6 * scale) + extraWidth,
    (6.5 * scale) + extraWidth,
  ];
  return [
    "interpolate", ["linear"], ["zoom"],
    2, widthAtScale(1),
    6, widthAtScale(1.35),
    10, widthAtScale(1.8),
    13, widthAtScale(2.35),
  ];
}

function riverColorExpression() {
  const width = ["to-number", ["get", "width"]];
  return [
    "case",
    ["<=", width, 0],
    "#64748b",
    [
      "case",
      ["<", width, 50], "#2587ff",
      ["<", width, 150], "#12c9e8",
      ["<", width, 500], "#31d39b",
      ["<=", width, 1500], "#ffd21f",
      "#f23824",
    ],
  ];
}

function bindMapInteractions() {
  map.on("mousemove", RIVER_HIT_LAYER, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;

    map.getCanvas().style.cursor = "pointer";
    if (hoveredFeatureId !== null && hoveredFeatureId !== feature.id) {
      map.setFeatureState({ source: RIVER_SOURCE, id: hoveredFeatureId }, { hover: false });
    }
    hoveredFeatureId = feature.id;
    map.setFeatureState({ source: RIVER_SOURCE, id: hoveredFeatureId }, { hover: true });

    const props = feature.properties;
    const name = props.river_name || "Unnamed river reach";
    const width = cleanNumber(props.width);
    els.mapTooltip.innerHTML = `<strong>${escapeHtml(name)}</strong>${width > 0 ? `${formatNumber(width)} m wide` : "Width unavailable"}`;
    els.mapTooltip.hidden = false;
    els.mapTooltip.style.left = `${event.point.x}px`;
    els.mapTooltip.style.top = `${event.point.y}px`;
  });

  map.on("mouseleave", RIVER_HIT_LAYER, () => {
    map.getCanvas().style.cursor = "";
    els.mapTooltip.hidden = true;
    if (hoveredFeatureId !== null) {
      map.setFeatureState({ source: RIVER_SOURCE, id: hoveredFeatureId }, { hover: false });
      hoveredFeatureId = null;
    }
  });

  map.on("click", RIVER_HIT_LAYER, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    selectReach(feature);
  });
}

function selectReach(feature) {
  if (selectedFeatureId !== null) {
    map.setFeatureState({ source: RIVER_SOURCE, id: selectedFeatureId }, { selected: false });
  }
  selectedFeatureId = feature.id;
  map.setFeatureState({ source: RIVER_SOURCE, id: selectedFeatureId }, { selected: true });

  selectedProperties = normalizeProperties(feature.properties);
  renderReachDetails(selectedProperties);
  loadDischarge(selectedProperties.reach_id);
}

function clearSelection() {
  if (selectedFeatureId !== null && map.getSource(RIVER_SOURCE)) {
    map.setFeatureState({ source: RIVER_SOURCE, id: selectedFeatureId }, { selected: false });
  }
  selectedFeatureId = null;
  selectedProperties = null;
  if (activeRequest) activeRequest.abort();
  activeRequest = null;
  latestDownload = null;
  els.downloadButton.disabled = true;
  els.reachDetails.hidden = true;
  els.reachEmpty.hidden = false;
  els.reachMessage.textContent = "";
  els.chartSubtitle.textContent = "Select a reach to view observations.";
  els.chartStatus.textContent = "";
  els.chartStatus.className = "chart-status";
  resetStats();
  showChartMessage("Discharge series will appear here.");
}

function renderReachDetails(props) {
  els.reachEmpty.hidden = true;
  els.reachDetails.hidden = false;
  els.riverName.textContent = props.river_name || "Unnamed river reach";
  els.reachId.textContent = props.reach_id;
  els.reachWse.textContent = isFiniteNumber(props.wse) ? `${formatNumber(props.wse)} m` : "Unavailable";
  els.reachWidth.textContent = props.width > 0 ? `${formatNumber(props.width)} m` : "Unavailable";
  els.reachSlope.textContent = isFiniteNumber(props.slope) ? `${formatSlope(props.slope)} m/km` : "Unavailable";
  els.reachDistance.textContent = isFiniteNumber(props.dist_out)
    ? `${formatNumber(props.dist_out / 1000)} km`
    : "Unavailable";
  els.selectedPeriod.textContent = `${els.startDate.value} to ${els.endDate.value}`;
  els.widthChip.textContent = props.width > 0 ? `${formatNumber(props.width)} m wide` : "Width unavailable";
  els.widthChip.style.background = widthColor(props.width);
  els.reachMessage.textContent = "Loading discharge products…";
  els.reachMessage.className = "reach-message";
}

async function loadDischarge(publicReachId) {
  if (!datesAreValid()) return;

  const v16ReachId = crosswalk[String(publicReachId)];
  const riverLabel = selectedProperties?.river_name || "Unnamed river reach";
  els.chartSubtitle.textContent = `${riverLabel} · Reach ${publicReachId}`;
  latestDownload = null;
  els.downloadButton.disabled = true;
  resetStats();

  if (!v16ReachId) {
    els.reachMessage.textContent = "Discharge data are unavailable because this reach has no corresponding historical lookup ID.";
    els.reachMessage.className = "reach-message error";
    els.chartStatus.textContent = "No compatible record";
    els.chartStatus.className = "chart-status";
    showChartMessage("No discharge data are available for this reach.");
    return;
  }

  const cacheKey = `${publicReachId}|${v16ReachId}|${els.startDate.value}|${els.endDate.value}`;
  const cached = dischargeCache.get(cacheKey);
  if (cached) {
    renderDischarge(cached.series, cached.unit, cached.rows);
    return;
  }

  if (activeRequest) activeRequest.abort();
  const requestController = new AbortController();
  activeRequest = requestController;
  els.chartStatus.textContent = "Loading Hydrocron";
  els.chartStatus.className = "chart-status loading";
  els.reachMessage.textContent = "Loading discharge products…";
  showChartMessage("Loading discharge products…");

  const params = new URLSearchParams({
    feature: "Reach",
    feature_id: v16ReachId,
    start_time: `${els.startDate.value}T00:00:00Z`,
    end_time: `${els.endDate.value}T23:59:59Z`,
    output: "csv",
    compact: "true",
    collection_name: "SWOT_L2_HR_RiverSP_2.0",
    fields: HYDROCRON_FIELDS,
  });

  try {
    const response = await fetch(`${HYDROCRON_URL}?${params}`, {
      headers: { Accept: "application/json" },
      signal: requestController.signal,
    });

    if (!response.ok) {
      if (response.status === 400 || response.status === 404) {
        throw new NoDataError();
      }
      throw new Error(`Hydrocron returned ${response.status}.`);
    }

    const payload = await response.json();
    const csv = payload?.results?.csv ?? payload?.csv ?? "";
    const rows = parseCsv(csv);
    const series = DISCHARGE_SERIES.map((definition) => ({
      ...definition,
      points: cleanDischargeRows(rows, definition.field),
    }));
    const unit = normalizeUnit(DISCHARGE_SERIES
      .map((definition) => rows.find((row) => row[`${definition.field}_units`])?.[`${definition.field}_units`])
      .find(Boolean));
    const downloadRows = rows.map((row) => ({ ...row, reach_id: String(publicReachId) }));

    if (!rows.length) throw new NoDataError();
    dischargeCache.set(cacheKey, { series, unit, rows: downloadRows });
    renderDischarge(series, unit, downloadRows);
  } catch (error) {
    if (error.name === "AbortError") return;
    const noData = error instanceof NoDataError;
    els.chartStatus.textContent = noData ? "No observations" : "Request unavailable";
    els.chartStatus.className = "chart-status";
    els.reachMessage.textContent = noData
      ? "No discharge observations were returned for this date range."
      : "Hydrocron could not be reached. Please try again in a moment.";
    els.reachMessage.className = "reach-message error";
    showChartMessage(noData ? "No observations were found in the selected date range." : "The discharge service is temporarily unavailable.");
  } finally {
    if (activeRequest === requestController) activeRequest = null;
  }
}

function renderDischarge(series, unit, rows) {
  const availableSeries = series.filter((item) => item.points.length);
  const primarySeries = availableSeries[0] ?? null;

  if (primarySeries) {
    const stats = calculateStats(primarySeries.points.map((point) => point.value));
    els.statMin.textContent = formatNumber(stats.min);
    els.statMax.textContent = formatNumber(stats.max);
    els.statMedian.textContent = formatNumber(stats.median);
    els.statStd.textContent = formatNumber(stats.std);
    els.chartStatus.textContent = `Statistics: ${primarySeries.label} · ${primarySeries.points.length.toLocaleString()} observations`;
  } else {
    resetStats();
    els.chartStatus.textContent = `${rows.length.toLocaleString()} records · no valid plotted values`;
  }

  const availability = series.map((item) => `${item.label}: ${item.points.length.toLocaleString()}`).join(" · ");
  els.chartStatus.className = "chart-status";
  els.reachMessage.textContent = primarySeries
    ? `${availability}. Statistics summarize ${primarySeries.label}.`
    : `Hydrocron returned ${rows.length.toLocaleString()} records, but none contained valid values for the seven plotted discharge products.`;
  els.reachMessage.className = primarySeries ? "reach-message" : "reach-message error";
  latestDownload = {
    rows,
    reachId: selectedProperties.reach_id,
    riverName: selectedProperties.river_name || "Unnamed river reach",
  };
  els.downloadButton.disabled = rows.length === 0;
  if (primarySeries) {
    drawChart(availableSeries, unit);
  } else {
    showChartMessage("No valid plotted discharge observations were found. The returned records can still be downloaded.");
  }
}

function drawChart(series, unit) {
  const width = 900;
  const height = 320;
  const margin = { top: 22, right: 25, bottom: 46, left: 76 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const allPoints = series.flatMap((item) => item.points);
  const dates = allPoints.map((point) => point.date.getTime());
  const values = allPoints.map((point) => point.value);
  let minX = Math.min(...dates);
  let maxX = Math.max(...dates);
  let minY = Math.min(...values);
  let maxY = Math.max(...values);
  const useLogScale = values.every((value) => value > 0);

  if (minX === maxX) {
    minX -= 86400000;
    maxX += 86400000;
  }
  const x = (value) => margin.left + ((value - minX) / (maxX - minX)) * innerWidth;
  let y;
  let yTicks;

  if (useLogScale) {
    let minExponent = Math.floor(Math.log10(minY));
    let maxExponent = Math.ceil(Math.log10(maxY));
    if (minExponent === maxExponent) maxExponent += 1;
    minY = 10 ** minExponent;
    maxY = 10 ** maxExponent;
    y = (value) => margin.top + (1 - (Math.log10(value) - minExponent) / (maxExponent - minExponent)) * innerHeight;
    yTicks = Array.from({ length: maxExponent - minExponent + 1 }, (_, index) => 10 ** (minExponent + index));
  } else {
    if (minY === maxY) {
      const padding = Math.max(Math.abs(minY) * 0.08, 1);
      minY -= padding;
      maxY += padding;
    } else {
      const padding = (maxY - minY) * 0.1;
      minY -= padding;
      maxY += padding;
    }
    y = (value) => margin.top + (1 - (value - minY) / (maxY - minY)) * innerHeight;
    yTicks = Array.from({ length: 5 }, (_, index) => minY + ((maxY - minY) * index) / 4);
  }

  const xTicks = Array.from({ length: 4 }, (_, index) => new Date(minX + ((maxX - minX) * index) / 3));
  const seriesMarkup = series.map((item) => {
    const path = item.points.map((point, index) => `${index ? "L" : "M"}${x(point.date.getTime()).toFixed(2)},${y(point.value).toFixed(2)}`).join(" ");
    const pointStep = item.points.length > 120 ? Math.ceil(item.points.length / 80) : 1;
    const lineWidth = item.key === "consensus" ? 5.5 : 2.6;
    const pointRadius = item.key === "consensus" ? 4.5 : 3.6;
    const pointsMarkup = item.points.map((point, index) => index % pointStep === 0 || index === item.points.length - 1
      ? `<circle class="chart-point" style="--series-color:${item.color}" tabindex="0" cx="${x(point.date.getTime())}" cy="${y(point.value)}" r="${pointRadius}" data-series="${item.key}" data-index="${index}" aria-label="${escapeHtml(item.label)}, ${formatAccessibleDate(point.date)}: ${formatNumber(point.value)} ${escapeHtml(unit)}" />`
      : "").join("");
    return `<path class="chart-line${item.key === "consensus" ? " chart-line-consensus" : ""}" style="--series-color:${item.color};--series-width:${lineWidth}" d="${path}" />${pointsMarkup}`;
  }).join("");

  els.chartWrap.innerHTML = `
    <svg class="discharge-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Seven SWOT discharge product time series">
      ${yTicks.map((tick) => `
        <line class="chart-grid-line" x1="${margin.left}" x2="${width - margin.right}" y1="${y(tick)}" y2="${y(tick)}" />
        <text class="chart-axis-text" x="${margin.left - 10}" y="${y(tick) + 4}" text-anchor="end">${escapeHtml(formatCompact(tick))}</text>
      `).join("")}
      ${xTicks.map((tick) => `
        <text class="chart-axis-text" x="${x(tick.getTime())}" y="${height - 17}" text-anchor="middle">${formatChartDate(tick)}</text>
      `).join("")}
      ${seriesMarkup}
      <text class="chart-axis-text" transform="translate(18 ${margin.top + innerHeight / 2}) rotate(-90)" text-anchor="middle">Discharge${unit ? ` (${escapeHtml(unit)})` : ""}</text>
    </svg>
    <div class="chart-tooltip" id="chart-tooltip" hidden></div>
  `;

  els.chartTooltip = els.chartWrap.querySelector("#chart-tooltip");
  const seriesByKey = new Map(series.map((item) => [item.key, item]));
  els.chartWrap.querySelectorAll(".chart-point").forEach((node) => {
    const show = () => {
      const item = seriesByKey.get(node.dataset.series);
      const point = item.points[Number(node.dataset.index)];
      const svgRect = node.ownerSVGElement.getBoundingClientRect();
      const cx = Number(node.getAttribute("cx"));
      const cy = Number(node.getAttribute("cy"));
      els.chartTooltip.innerHTML = `<strong>${escapeHtml(item.label)} · ${formatNumber(point.value)} ${escapeHtml(unit)}</strong>${formatAccessibleDate(point.date)}`;
      els.chartTooltip.style.left = `${(cx / width) * svgRect.width}px`;
      els.chartTooltip.style.top = `${(cy / height) * svgRect.height}px`;
      els.chartTooltip.hidden = false;
    };
    node.addEventListener("mouseenter", show);
    node.addEventListener("focus", show);
    node.addEventListener("mouseleave", () => { els.chartTooltip.hidden = true; });
    node.addEventListener("blur", () => { els.chartTooltip.hidden = true; });
  });
}

function showChartMessage(message) {
  els.chartWrap.innerHTML = `
    <div class="chart-empty" id="chart-empty">
      <svg viewBox="0 0 160 70" aria-hidden="true">
        <path d="M3 59 29 44l24 7 25-31 27 16 24-23 28 6" />
        <path class="baseline" d="M3 66h154" />
      </svg>
      <p>${escapeHtml(message)}</p>
    </div>
    <div class="chart-tooltip" id="chart-tooltip" hidden></div>
  `;
  els.chartTooltip = els.chartWrap.querySelector("#chart-tooltip");
}

function downloadSelectedSeries() {
  if (!latestDownload) return;
  const discoveredHeaders = [...new Set(latestDownload.rows.flatMap((row) => Object.keys(row)))];
  const headers = ["reach_id", ...discoveredHeaders.filter((header) => header !== "reach_id")];
  const csvRows = latestDownload.rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(","));
  const blob = new Blob([[headers.join(","), ...csvRows].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeName = latestDownload.riverName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "river-reach";
  link.href = url;
  link.download = `${safeName}-${latestDownload.reachId}-discharge.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function escapeCsvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function setBaseMap(styleName) {
  BASE_LAYERS.forEach((layerId) => {
    map.setLayoutProperty(layerId, "visibility", layerId === `${styleName}-base` ? "visible" : "none");
  });
}

function setDefaultDates() {
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  els.startDate.value = "2023-04-01";
  els.endDate.value = end.toISOString().slice(0, 10);
  els.endDate.max = end.toISOString().slice(0, 10);
}

function datesAreValid() {
  if (!els.startDate.value || !els.endDate.value) {
    els.dateError.textContent = "Choose both dates.";
    return false;
  }
  if (els.startDate.value > els.endDate.value) {
    els.dateError.textContent = "Start date must be before end date.";
    return false;
  }
  els.dateError.textContent = "";
  return true;
}

function normalizeProperties(props) {
  return {
    reach_id: String(props.reach_id),
    river_name: props.river_name || "",
    wse: cleanNumber(props.wse),
    width: cleanNumber(props.width),
    slope: cleanNumber(props.slope),
    dist_out: cleanNumber(props.dist_out),
  };
}

function cleanDischargeRows(rows, field) {
  const unique = new Map();
  rows.forEach((row) => {
    if (!row.time_str || row.time_str === "no_data") return;
    const date = new Date(row.time_str);
    const value = Number(row[field]);
    if (Number.isNaN(date.getTime()) || !Number.isFinite(value) || Math.abs(value) >= 1e10) return;
    unique.set(date.toISOString(), { date, value });
  });
  return [...unique.values()].sort((a, b) => a.date - b.date);
}

function parseCsv(text) {
  if (!text || typeof text !== "string") return [];
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (rows.length < 2) return [];
  const headers = rows.shift().map((header) => header.trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function calculateStats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;
  return {
    min: sorted[0],
    max: sorted.at(-1),
    median,
    std: Math.sqrt(variance),
  };
}

function resetStats() {
  [els.statMin, els.statMax, els.statMedian, els.statStd].forEach((element) => {
    element.textContent = "—";
  });
}

function widthColor(width) {
  if (!Number.isFinite(width) || width <= 0) return "#64748b";
  if (width <= 50) return "#1685ff";
  if (width <= 150) return "#00aaf4";
  if (width <= 500) return "#00d0c2";
  if (width <= 1500) return "#9ddf28";
  if (width <= 3000) return "#ffd51f";
  if (width <= 5000) return "#ff7815";
  return "#f52222";
}

function cleanNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  const maximumFractionDigits = magnitude >= 1000 ? 0 : magnitude >= 100 ? 1 : magnitude >= 10 ? 1 : 2;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

function formatCompact(value) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 10000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) < 10 ? 1 : 0,
  }).format(value);
}

function formatSlope(value) {
  if (!Number.isFinite(value)) return "—";
  if (value !== 0 && Math.abs(value) < 0.001) return value.toExponential(2);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value);
}

function formatChartDate(date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).format(date);
}

function formatAccessibleDate(date) {
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function normalizeUnit(unit) {
  if (!unit) return "m³/s";
  return String(unit).replace("m^3", "m³").replace("m3", "m³");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

class NoDataError extends Error {}
