const captainModel = require("../models/captain.model");
const { validationResult } = require("express-validator");
const captainService = require("../services/captain.service");
const tokenBlacklist = require("../services/tokenBlacklist.service");

module.exports.registerCaptain = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // The route validates vehicle.*, so the controller must read it too.
    const { fullname, email, password, vehicle } = req.body;

    const isCaptainExists = await captainModel.findOne({ email });
    if (isCaptainExists) {
      return res.status(400).json({ message: "Captain already exists" });
    }

    const hashedPassword = await captainModel.hashPassword(password);

    const captain = await captainService.createCaptain({
      firstname: fullname.firstname,
      lastname: fullname.lastname,
      email,
      password: hashedPassword,
      color: vehicle.color,
      plate: vehicle.plate,
      capacity: vehicle.capacity,
      vehicleType: vehicle.vehicleType,
    });

    const token = captain.generateAuthToken();

    res.status(201).json({ token, captain });
  } catch (error) {
    console.error("Error in registerCaptain:", error);
    next(error);
  }
};

module.exports.loginCaptain = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // password has select:false on the schema, so it must be asked for explicitly.
    const captain = await captainModel.findOne({ email }).select("+password");

    // Same message and status for "no such email" and "wrong password", so the
    // endpoint cannot be used to find out which emails are registered.
    if (!captain) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await captain.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = captain.generateAuthToken();
    res.cookie("token", token, { httpOnly: true });
    res.status(200).json({ token, captain });
  } catch (error) {
    console.error("Error in loginCaptain:", error);
    next(error);
  }
};

module.exports.getCaptainProfile = async (req, res, next) => {
  res.status(200).json({ captain: req.captain });
};

module.exports.logoutCaptain = async (req, res, next) => {
  try {
    // req.token was set by the auth middleware after verifying the signature.
    await tokenBlacklist.blacklistToken(req.token);

    res.clearCookie("token");
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("Error in logoutCaptain:", error);
    next(error);
  }
};
