const express = require("express");
const cors = require("cors");

const routes = require("./routes");

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
  }),
);

app.use(express.json());

app.use("/api/v1", routes);

module.exports = app;
