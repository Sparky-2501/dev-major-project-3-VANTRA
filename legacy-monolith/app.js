const express = require('express');
const dotenv = require('dotenv');
dotenv.config();
const cors = require('cors');
const app = express();
const cookieParser = require('cookie-parser');
const userRoutes = require('./routes/user.routes');
const captainRoutes = require('./routes/captain.routes');
const connectToDb = require('./db/db');
connectToDb();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(cookieParser());

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.use('/users', userRoutes);
app.use('/captains', captainRoutes);
// Without this, an error passed to next() makes Express 5 send an HTML stack
// trace. Clients of a JSON API should always get JSON, and never a stack trace.
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

module.exports = app;