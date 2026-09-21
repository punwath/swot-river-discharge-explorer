const fs = require("node:fs");
const path = require("node:path");

const inputPath = process.argv[2];
const fallbackInputPath = process.argv[3];
if (!inputPath) {
  console.error("Usage: node scripts/prepare-data.cjs <source.geojson> [fallback-properties.geojson]");
  process.exit(1);
}

const outputDirectory = path.resolve(__dirname, "..", "data");
const source = JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"));
const fallbackProperties = loadFallbackProperties(fallbackInputPath);

if (source.type !== "FeatureCollection" || !Array.isArray(source.features)) {
  throw new Error("Expected a GeoJSON FeatureCollection.");
}

const crosswalk = {};
let missingLookupCount = 0;
let missingNameCount = 0;
const bounds = [Infinity, Infinity, -Infinity, -Infinity];

const features = source.features.map((feature) => {
  const properties = feature.properties || {};
  const reachId = String(properties.reach_id);
  const fallback = fallbackProperties.get(reachId) || {};
  const v16 = Number(properties.v16_reach_id);
  const name = cleanText(properties.river_name_en ?? properties.river_name ?? fallback.river_name_en ?? fallback.river_name);
  const width = cleanPositive(properties.width);
  const coordinates = feature.geometry.coordinates.map((coordinate) => {
    const rounded = [roundCoordinate(coordinate[0]), roundCoordinate(coordinate[1])];
    bounds[0] = Math.min(bounds[0], rounded[0]);
    bounds[1] = Math.min(bounds[1], rounded[1]);
    bounds[2] = Math.max(bounds[2], rounded[0]);
    bounds[3] = Math.max(bounds[3], rounded[1]);
    return rounded;
  });

  crosswalk[reachId] = Number.isFinite(v16) && v16 > 0 ? String(Math.trunc(v16)) : null;
  if (!crosswalk[reachId]) missingLookupCount += 1;
  if (!name) missingNameCount += 1;

  return {
    type: "Feature",
    properties: {
      reach_id: reachId,
      river_name: name,
      wse: cleanFinite(properties.wse),
      width,
      slope: cleanNonNegative(properties.slope ?? fallback.slope),
      dist_out: cleanNonNegative(properties.dist_out ?? properties.hydro_dist_out),
    },
    geometry: {
      type: feature.geometry.type,
      coordinates,
    },
  };
});

const output = {
  type: "FeatureCollection",
  bbox: bounds,
  features,
};

function loadFallbackProperties(filePath) {
  const lookup = new Map();
  if (!filePath) return lookup;
  const fallbackSource = JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
  if (fallbackSource.type !== "FeatureCollection" || !Array.isArray(fallbackSource.features)) {
    throw new Error("Expected the fallback file to be a GeoJSON FeatureCollection.");
  }
  fallbackSource.features.forEach((feature) => {
    const properties = feature.properties || {};
    if (properties.reach_id !== null && properties.reach_id !== undefined) {
      lookup.set(String(properties.reach_id), properties);
    }
  });
  return lookup;
}

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(path.join(outputDirectory, "reaches.geojson"), JSON.stringify(output));
fs.writeFileSync(path.join(outputDirectory, "reach-v16.json"), JSON.stringify(crosswalk));

console.log(JSON.stringify({
  features: features.length,
  missingLookupCount,
  missingNameCount,
  bbox: bounds,
  geometryBytes: fs.statSync(path.join(outputDirectory, "reaches.geojson")).size,
  lookupBytes: fs.statSync(path.join(outputDirectory, "reach-v16.json")).size,
}, null, 2));

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function cleanFinite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? roundValue(number) : null;
}

function cleanPositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? roundValue(number) : null;
}

function cleanNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? roundValue(number) : null;
}

function roundCoordinate(value) {
  return Math.round(Number(value) * 1e6) / 1e6;
}

function roundValue(value) {
  return Math.round(value * 1e6) / 1e6;
}
