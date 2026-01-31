/**
 * Route Aggregator - Combines all route modules
 */

const express = require('express');

const uploadRoutes = require('./upload');
const historyRoutes = require('./history');
const settingsRoutes = require('./settings');
const refreshRoutes = require('./refresh');
const reanalysisRoutes = require('./reanalysis');

const router = express.Router();

// Mount all routes
router.use(uploadRoutes);
router.use(historyRoutes);
router.use(settingsRoutes);
router.use(refreshRoutes);
router.use(reanalysisRoutes);

module.exports = router;
