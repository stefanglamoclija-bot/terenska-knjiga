'use strict';
// Independent reference geodesy, written from the literature (not copied from the app):
// Transverse Mercator by the Krüger n-series (Karney 2011, 4th order; sub-millimetre within a zone),
// geodetic<->ECEF with an iterative inverse, and a 3-parameter geocentric shift.
const D2R = Math.PI / 180;
const ELL = { bessel: { a: 6377397.155, f: 1 / 299.1528128 }, wgs84: { a: 6378137, f: 1 / 298.257223563 } };

function coeffs(el) {
  const n = el.f / (2 - el.f), n2 = n * n, n3 = n2 * n, n4 = n3 * n;
  const A = el.a / (1 + n) * (1 + n2 / 4 + n4 / 64);
  const al = [0, n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180, 13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440, 61 * n3 / 240 - 103 * n4 / 140, 49561 * n4 / 161280];
  const be = [0, n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360, n2 / 48 + n3 / 15 - 437 * n4 / 1440, 17 * n3 / 480 - 37 * n4 / 840, 4397 * n4 / 161280];
  const de = [0, 2 * n - 2 * n2 / 3 - 2 * n3 + 116 * n4 / 45, 7 * n2 / 3 - 8 * n3 / 5 - 227 * n4 / 45, 56 * n3 / 15 - 136 * n4 / 35, 4279 * n4 / 630];
  return { n, A, al, be, de, e: 2 * Math.sqrt(n) / (1 + n) };
}

function tmForward(lat, lon, el, lon0, k0, FE, FN = 0) {
  const c = coeffs(el), p = lat * D2R, dl = (lon - lon0) * D2R;
  const t = Math.sinh(Math.atanh(Math.sin(p)) - c.e * Math.atanh(c.e * Math.sin(p)));
  const xi = Math.atan(t / Math.cos(dl)), eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let x = eta, y = xi;
  for (let j = 1; j <= 4; j++) { x += c.al[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); y += c.al[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); }
  return { E: FE + k0 * c.A * x, N: FN + k0 * c.A * y };
}

function tmInverse(E, N, el, lon0, k0, FE, FN = 0) {
  const c = coeffs(el), xi = (N - FN) / (k0 * c.A), eta = (E - FE) / (k0 * c.A);
  let xi1 = xi, eta1 = eta;
  for (let j = 1; j <= 4; j++) { xi1 -= c.be[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); eta1 -= c.be[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
  const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
  let p = chi; for (let j = 1; j <= 4; j++) p += c.de[j] * Math.sin(2 * j * chi);
  const lon = lon0 * D2R + Math.atan2(Math.sinh(eta1), Math.cos(xi1));
  return { lat: p / D2R, lon: lon / D2R };
}

function toEcef(lat, lon, el, h = 0) {
  const e2 = el.f * (2 - el.f), p = lat * D2R, l = lon * D2R, N = el.a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  return [(N + h) * Math.cos(p) * Math.cos(l), (N + h) * Math.cos(p) * Math.sin(l), (N * (1 - e2) + h) * Math.sin(p)];
}
function fromEcef(X, Y, Z, el) {
  const e2 = el.f * (2 - el.f), p = Math.hypot(X, Y);
  let lat = Math.atan2(Z, p * (1 - e2)), h = 0;
  for (let i = 0; i < 10; i++) { const N = el.a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2); h = p / Math.cos(lat) - N; lat = Math.atan2(Z, p * (1 - e2 * N / (N + h))); }
  return { lat: lat / D2R, lon: Math.atan2(Y, X) / D2R, h };
}

const SHIFT = [682, -203, 480]; // the same demo parameters the app uses; the model is what we check, not the values
function mgiGk6ToWgs(Y, X) { const g = tmInverse(Y, X, ELL.bessel, 18, 0.9999, 6500000); const e = toEcef(g.lat, g.lon, ELL.bessel); return fromEcef(e[0] + SHIFT[0], e[1] + SHIFT[1], e[2] + SHIFT[2], ELL.wgs84); }
function wgsToMgiGk6(lat, lon) { const e = toEcef(lat, lon, ELL.wgs84); const g = fromEcef(e[0] - SHIFT[0], e[1] - SHIFT[1], e[2] - SHIFT[2], ELL.bessel); const r = tmForward(g.lat, g.lon, ELL.bessel, 18, 0.9999, 6500000); return { Y: r.E, X: r.N }; }
const utm34Fwd = (lat, lon) => tmForward(lat, lon, ELL.wgs84, 21, 0.9996, 500000);
const utm34Inv = (E, N) => tmInverse(E, N, ELL.wgs84, 21, 0.9996, 500000);

// metres between two lat/lon points (local flat approximation; fine for < 1 km)
function metres(a, b) { const R = 6371000, dl = (b.lat - a.lat) * D2R, dn = (b.lon - a.lon) * D2R * Math.cos(a.lat * D2R); return R * Math.hypot(dl, dn); }

module.exports = { ELL, tmForward, tmInverse, toEcef, fromEcef, mgiGk6ToWgs, wgsToMgiGk6, utm34Fwd, utm34Inv, metres, SHIFT };
