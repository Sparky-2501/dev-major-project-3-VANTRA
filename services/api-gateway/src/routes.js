// The routing table: path prefix -> which service, what the path becomes there,
// and which role may call it. This one table is the whole "API gateway" story.
const urls = {
  rider: process.env.RIDER_SERVICE_URL || 'http://rider-service:3001',
  driver: process.env.DRIVER_SERVICE_URL || 'http://driver-service:3002',
  matching: process.env.MATCHING_SERVICE_URL || 'http://matching-service:3003',
  payment: process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3004',
  notification: process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3005',
};

// role: who may call it ('any' = rider or driver)
// public: sub-paths that need no token (register/login)
module.exports.urls = urls;
module.exports.routes = [
  { prefix: '/api/riders',   target: urls.rider,    rewrite: '/riders',   role: 'rider',  public: ['/register', '/login'] },
  { prefix: '/api/rides',    target: urls.rider,    rewrite: '/rides',    role: 'rider' },
  { prefix: '/api/drivers',  target: urls.driver,   rewrite: '/drivers',  role: 'driver', public: ['/register', '/login'] },
  { prefix: '/api/matching', target: urls.matching, rewrite: '/matching', role: 'driver' },
  // Demo toggles. Only exist when DEMO_MODE=true (checked in app.js).
  { prefix: '/api/demo/payment',  target: urls.payment,  rewrite: '/internal/demo', role: 'any', demo: true },
  { prefix: '/api/demo/driver',   target: urls.driver,   rewrite: '/internal/demo', role: 'any', demo: true },
  { prefix: '/api/demo/matching', target: urls.matching, rewrite: '/internal/demo', role: 'any', demo: true },
  // The notification "log sink": lets scripts check what was pushed.
  { prefix: '/api/demo/notifications', target: urls.notification, rewrite: '/internal/notifications', role: 'any', demo: true },
];
