// Every Redis key and stream name lives here so two services can never disagree
// about a spelling. Coordinates everywhere are (lng, lat) in that order, the same
// as GeoJSON and as Redis GEOADD/GEOSEARCH. Mixing the order up is the classic
// geo bug, so it is written down once, here.
module.exports = {
  GEO_AVAILABLE: 'drivers:available',      // GEO set: member = driverId
  EVENTS_STREAM: 'events:rides',           // Redis Stream of domain events
  NOTIFY_GROUP: 'notification-service',    // consumer group for that stream
  NOTIFY_RECENT: 'notifications:recent',   // list of the last pushed notifications

  driverHeartbeat: (id) => `driver:hb:${id}`,   // exists while the driver keeps pinging
  driverState: (id) => `driver:state:${id}`,    // hash: online, lng, lat, rideId
  driverLock: (id) => `driver:lock:${id}`,      // value = rideId that reserved the driver
  driverOffer: (id) => `driver:offer:${id}`,    // value = rideId currently offered
  offerResponse: (rideId, driverId) => `offer:resp:${rideId}:${driverId}`,
  rideCancelFlag: (rideId) => `ride:cancel:${rideId}`,

  // Demo toggles (only honoured when DEMO_MODE=true)
  DEMO_PAYMENT_FAIL_RATE: 'demo:payment:failRate',
  DEMO_DRIVER_OUTAGE: 'demo:driver:outage',
  DEMO_SILENT_DRIVERS: 'demo:silent-drivers',
};
