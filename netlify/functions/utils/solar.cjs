// Minimal shim for admin-diagnostics legacy import.
// Provides a stub getSolarData to avoid require-time failures; replace with real impl if needed.
module.exports = {
  /**
   * Returns minimal solar data structure; extend to call solar-estimate if required.
   */
  getSolarData: async (lat, lon) => ({ sunrise: null, sunset: null, lat, lon, source: 'shim' })
};
