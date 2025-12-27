
const { extractHardwareSystemId } = require('./netlify/functions/extract-hardware-id.cjs');

const testCases = [
    "System ID: DL-1234",
    "DL Number: 5678",
    "DL-9012",
    "Reference DL-3456 in the logs",
    "Just a random string"
];

testCases.forEach(text => {
    const ids = extractHardwareSystemId(text);
    console.log(`Text: "${text}" -> IDs:`, ids);
});
