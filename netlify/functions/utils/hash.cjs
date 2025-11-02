"use strict";

const crypto = require("crypto");

function sha256HexFromBase64(base64String) {
  const buffer = Buffer.from(base64String, "base64");
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

module.exports = { sha256HexFromBase64 };


