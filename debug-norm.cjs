const { normalizeHardwareId } = require('./netlify/functions/utils/analysis-helpers.cjs');

const id1 = "JHBC890A8D82CF8";
const id2 = "JHB-C890A8D82CF8";
const id3 = "DL 123";

console.log(`Original: ${id1} -> Normalized: ${normalizeHardwareId(id1)}`);
console.log(`Original: ${id2} -> Normalized: ${normalizeHardwareId(id2)}`);
console.log(`Original: ${id3} -> Normalized: ${normalizeHardwareId(id3)}`);
