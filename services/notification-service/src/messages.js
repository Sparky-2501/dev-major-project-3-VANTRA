// Pure function: domain event -> list of { to: 'rider:<id>' | 'driver:<id>', text }.
// Kept free of I/O so it can be unit-tested without Redis or sockets.
module.exports.messagesFor = (type, d = {}) => {
  const rider = d.riderId ? `rider:${d.riderId}` : null;
  const driver = d.driverId ? `driver:${d.driverId}` : null;
  const out = [];
  const add = (to, text) => { if (to) out.push({ to, text }); };

  switch (type) {
    case 'ride.requested': add(rider, 'Looking for a driver near you...'); break;
    case 'ride.offered': add(driver, `New ride request, ${d.distanceKm ?? '?'} km away. Accept within ${d.expiresInSec ?? '?'}s.`); break;
    case 'driver.assigned': add(rider, 'A driver accepted your ride.'); break;
    case 'ride.confirmed': add(rider, 'Your ride is confirmed.'); add(driver, 'Ride confirmed. Head to the pickup point.'); break;
    case 'payment.captured': add(rider, `Payment of ${d.amount} ${d.currency || ''} received. Thank you!`.trim()); break;
    case 'ride.cancelled': add(rider, `Ride cancelled (${d.reason || 'unknown reason'}).`); add(driver, 'The ride was cancelled.'); break;
    case 'ride.completed': add(rider, 'You have arrived. Ride completed.'); add(driver, 'Ride completed.'); break;
    default: break; // unknown event types are ignored, so new events never break this service
  }
  return out;
};
