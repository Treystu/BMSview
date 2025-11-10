// Minimal shim for admin-diagnostics legacy import.
module.exports = {
  getSolarData: async (lat, lon) => ({ sunrise: null, sunset: null, lat, lon, source: 'shim' })
};
