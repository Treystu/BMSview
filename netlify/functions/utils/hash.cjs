"use strict";

const crypto = require("crypto");

function sha256HexFromBase64(base64String) {
  try {
    const buffer = Buffer.from(base64String, "base64");
    return crypto.createHash("sha256").update(buffer).digest("hex");
  } catch (error) {
    console.error('Error in sha256HexFromBase64:', error);
    return null;
  }
}

module.exports = { sha256HexFromBase64 };


