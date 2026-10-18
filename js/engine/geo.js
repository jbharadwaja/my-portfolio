// Pure lattice geometry for the Route world map. Pacific-centred equirectangular
// lattice: column 0 sits at lon0 - 180, row 0 at latN. No three.js, no DOM.

/** Longitude wrapped to [-180, 180). */
export const wrap180 = (deg) => ((deg + 180) % 360 + 360) % 360 - 180;

/** Packed runs [row, start, len, start, len, ...] -> Uint16Array of interleaved (col, row), row-major. */
export function decodeRuns(map) {
  let n = 0;
  for (const run of map.runs) for (let k = 2; k < run.length; k += 2) n += run[k];
  const out = new Uint16Array(n * 2);
  let i = 0;
  for (const run of map.runs) {
    for (let k = 1; k < run.length; k += 2) {
      for (let c = run[k], end = run[k] + run[k + 1]; c < end; c++) { out[i++] = c; out[i++] = run[0]; }
    }
  }
  return out;
}

/**
 * Lattice cell containing a position. u, v are the unclamped [0, 1) map coordinates (v grows downward);
 * col and row are clamped onto the lattice.
 */
export function lonLatToCell(lon, lat, map) {
  const u = (wrap180(lon - map.lon0) + 180) / 360;
  const v = (map.latN - lat) / (map.latN - map.latS);
  const col = Math.min(map.cols - 1, Math.max(0, Math.floor(u * map.cols)));
  const row = Math.min(map.rows - 1, Math.max(0, Math.floor(v * map.rows)));
  return { col, row, u, v };
}

/** Centre of a lattice cell; lon wrapped to ±180. */
export function cellToLonLat(col, row, map) {
  return {
    lat: map.latN - (row + 0.5) * (map.latN - map.latS) / map.rows,
    lon: wrap180(map.lon0 - 180 + (col + 0.5) * 360 / map.cols),
  };
}

/** '34.13°N 117.92°W' (2 decimals). */
export function formatLatLon(lat, lon) {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
}
