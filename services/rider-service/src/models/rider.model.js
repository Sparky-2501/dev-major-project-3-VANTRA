const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const riderSchema = new mongoose.Schema({
  fullname: {
    firstname: { type: String, required: true, minlength: 2 },
    lastname: { type: String, minlength: 2 },
  },
  email: { type: String, required: true, unique: true, minlength: 5 },
  password: { type: String, required: true, select: false },
}, {
  // select:false hides the hash from queries only; this removes it from any JSON.
  toJSON: { transform: (doc, ret) => { delete ret.password; delete ret.__v; return ret; } },
});

riderSchema.methods.generateAuthToken = function () {
  // role stops a driver token working on rider routes (same secret signs both).
  return jwt.sign({ _id: this._id, role: 'rider' }, process.env.JWT_SECRET, { expiresIn: '24h' });
};
riderSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.password);
};
riderSchema.statics.hashPassword = (password) => bcrypt.hash(password, 10);

module.exports = mongoose.model('Rider', riderSchema);
