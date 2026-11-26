const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Driver profile only. LIVE state (online, location, current ride) is in Redis,
// because it changes every few seconds and must be readable by matching-service.
const driverSchema = new mongoose.Schema({
  fullname: {
    firstname: { type: String, required: true, minlength: 3 },
    lastname: { type: String, minlength: 3 },
  },
  email: { type: String, required: true, unique: true, match: /\S+@\S+\.\S+/ },
  password: { type: String, required: true, select: false },
  vehicle: {
    color: { type: String, required: true, minlength: 3 },
    plate: { type: String, required: true, minlength: 3 },
    capacity: { type: Number, required: true, min: 1 },
    vehicleType: { type: String, enum: ['car', 'auto', 'motorcycle'], required: true },
  },
}, {
  // select:false hides the hash from queries only; this removes it from any JSON.
  toJSON: { transform: (doc, ret) => { delete ret.password; delete ret.__v; return ret; } },
});

driverSchema.methods.generateAuthToken = function () {
  // role stops a rider token working on driver routes (same secret signs both).
  return jwt.sign({ _id: this._id, role: 'driver' }, process.env.JWT_SECRET, { expiresIn: '24h' });
};
driverSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.password);
};
driverSchema.statics.hashPassword = (password) => bcrypt.hash(password, 10);

module.exports = mongoose.model('Driver', driverSchema);
