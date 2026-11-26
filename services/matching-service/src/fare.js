// Great-circle distance in km (haversine). Inputs are { lng, lat } (lng first).
function distanceKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Simple deterministic fare in INR: base 30 + 12 per km, never below 50.
// Deterministic on purpose: the same trip must always give the same amount, so a
// retried booking cannot change the price.
function computeFare(pickup, dropoff) {
  return Math.max(50, Math.round(30 + 12 * distanceKm(pickup, dropoff)));
}

module.exports = { distanceKm, computeFare };
