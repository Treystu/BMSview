import React from 'react';
import { createLazyComponent, CodeSplittingHelpers } from '@/utils/bundleOptimization';

/**
 * Lazy-loaded component definitions for code splitting
 * Centralized location for all lazy components to improve bundle optimization
 */

// Loading fallback components
const RouteLoader = () => (
  <div className="flex items-center justify-center min-h-[200px]">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    <span className="ml-2 text-gray-600">Loading page...</span>
  </div>
);

const ComponentLoader = () => (
  <div className="flex items-center justify-center p-4">
    <div className="animate-pulse flex space-x-4">
      <div className="rounded-full bg-gray-300 h-10 w-10"></div>
      <div className="flex-1 space-y-2 py-1">
        <div className="h-4 bg-gray-300 rounded w-3/4"></div>
        <div className="h-4 bg-gray-300 rounded w-1/2"></div>
      </div>
    </div>
  </div>
);

const FeatureLoader = () => (
  <div className="p-6 max-w-sm mx-auto bg-white rounded-xl shadow-lg">
    <div className="animate-pulse flex space-x-4">
      <div className="rounded-full bg-gray-300 h-12 w-12"></div>
      <div className="flex-1 space-y-2 py-1">
        <div className="h-4 bg-gray-300 rounded"></div>
        <div className="h-4 bg-gray-300 rounded w-5/6"></div>
      </div>
    </div>
  </div>
);

// Route-level lazy components
export const LazyAnalysisResults = CodeSplittingHelpers.createRouteComponent(
  () => import('../AnalysisResults/AnalysisResults'),
  {
    fallback: <RouteLoader />,
    preload: true, // Preload since it's commonly used
  }
);

export const LazyFileUpload = CodeSplittingHelpers.createRouteComponent(
  () => import('../FileUpload/FileUpload'),
  {
    fallback: <RouteLoader />,
    preload: true, // Preload since it's the main interaction
  }
);

export const LazySystemManagement = CodeSplittingHelpers.createRouteComponent(
  () => import('../SystemManagement/SystemManagement'),
  {
    fallback: <RouteLoader />,
    preload: false, // Load on demand
  }
);

export const LazyHistoryView = CodeSplittingHelpers.createRouteComponent(
  () => import('../HistoryView/HistoryView'),
  {
    fallback: <RouteLoader />,
    preload: false,
  }
);

export const LazySettingsPanel = CodeSplittingHelpers.createRouteComponent(
  () => import('../Settings/SettingsPanel'),
  {
    fallback: <RouteLoader />,
    preload: false,
  }
);

// Feature-level lazy components
export const LazyChartComponent = CodeSplittingHelpers.createFeatureComponent(
  () => import('../Charts/ChartComponent'),
  {
    fallback: <FeatureLoader />,
    preload: false, // Only load when charts are needed
  }
);

export const LazyDataTable = CodeSplittingHelpers.createFeatureComponent(
  () => import('../DataTable/DataTable'),
  {
    fallback: <ComponentLoader />,
    preload: false,
  }
);

export const LazyExportDialog = CodeSplittingHelpers.createFeatureComponent(
  () => import('../Export/ExportDialog'),
  {
    fallback: <ComponentLoader />,
    preload: false, // Only load when export is triggered
  }
);

export const LazyNotificationCenter = CodeSplittingHelpers.createFeatureComponent(
  () => import('../Notifications/NotificationCenter'),
  {
    fallback: <ComponentLoader />,
    preload: false,
  }
);

export const LazyAdvancedFilters = CodeSplittingHelpers.createFeatureComponent(
  () => import('../Filters/AdvancedFilters'),
  {
    fallback: <ComponentLoader />,
    preload: false,
  }
);

export const LazyBulkOperations = CodeSplittingHelpers.createFeatureComponent(
  () => import('../BulkOperations/BulkOperations'),
  {
    fallback: <ComponentLoader />,
    preload: false,
  }
);

// Admin-only components
export const LazyAdminDashboard = CodeSplittingHelpers.createRouteComponent(
  () => import('../Admin/AdminDashboard'),
  {
    fallback: <RouteLoader />,
    preload: false,
  }
);

export const LazyUserManagement = CodeSplittingHelpers.createFeatureComponent(
  () => import('../Admin/UserManagement'),
  {
    fallback: <ComponentLoader />,
    preload: false,
  }
);

export const LazySystemMetrics = CodeSplittingHelpers.createFeatureComponent(
  () => import('../Admin/SystemMetrics'),
  {
    fallback: <ComponentLoader />,
    preload: false,
  }
);

// Utility lazy components for modals and overlays
export const LazyModal = createLazyComponent(
  () => import('../Modal/Modal'),
  {
    fallback: null, // No fallback for modals
    preload: true, // Preload since modals are commonly used
  }
);

export const LazyTooltip = createLazyComponent(
  () => import('../Tooltip/Tooltip'),
  {
    fallback: null,
    preload: true,
  }
);

export const LazyDatePicker = createLazyComponent(
  () => import('../DatePicker/DatePicker'),
  {
    fallback: <ComponentLoader />,
    preload: false,
  }
);

// Heavy third-party integrations
export const LazyPDFViewer = CodeSplittingHelpers.createFeatureComponent(
  () => import('../PDF/PDFViewer'),
  {
    fallback: <FeatureLoader />,
    preload: false,
  }
);

export const LazyMarkdownEditor = CodeSplittingHelpers.createFeatureComponent(
  () => import('../Markdown/MarkdownEditor'),
  {
    fallback: <ComponentLoader />,
    preload: false,
  }
);

export const LazyCodeEditor = CodeSplittingHelpers.createFeatureComponent(
  () => import('../CodeEditor/CodeEditor'),
  {
    fallback: <ComponentLoader />,
    preload: false,
  }
);

// Map/geolocation components
export const LazyMapView = CodeSplittingHelpers.createFeatureComponent(
  () => import('../Map/MapView'),
  {
    fallback: <FeatureLoader />,
    preload: false,
  }
);

export const LazyLocationPicker = CodeSplittingHelpers.createFeatureComponent(
  () => import('../Location/LocationPicker'),
  {
    fallback: <ComponentLoader />,
    preload: false,
  }
);

// Preloading configuration
export const PRELOAD_CONFIG = {
  // Components to preload on app start
  immediate: [
    'LazyAnalysisResults',
    'LazyFileUpload',
    'LazyModal',
    'LazyTooltip',
  ],

  // Components to preload after initial load
  afterLoad: [
    'LazySystemManagement',
    'LazyHistoryView',
  ],

  // Components to preload on user interaction
  onInteraction: {
    'chart-view': ['LazyChartComponent'],
    'export-action': ['LazyExportDialog'],
    'filter-advanced': ['LazyAdvancedFilters'],
    'admin-panel': ['LazyAdminDashboard'],
  },
};

// Preloader function
export const preloadComponents = (category: keyof typeof PRELOAD_CONFIG) => {
  if (category === 'onInteraction') {
    return; // Handle separately
  }

  const components = PRELOAD_CONFIG[category];
  components.forEach(componentName => {
    const component = exports[componentName as keyof typeof exports];
    if (component && typeof component.preload === 'function') {
      component.preload();
    }
  });
};

// Interaction-based preloader
export const preloadOnInteraction = (interactionType: string) => {
  const components = PRELOAD_CONFIG.onInteraction[interactionType as keyof typeof PRELOAD_CONFIG.onInteraction];
  if (components) {
    components.forEach(componentName => {
      const component = exports[componentName as keyof typeof exports];
      if (component && typeof component.preload === 'function') {
        component.preload();
      }
    });
  }
};

// Component registry for dynamic loading
export const LAZY_COMPONENT_REGISTRY = {
  // Analysis & Results
  'analysis-results': LazyAnalysisResults,
  'chart-component': LazyChartComponent,
  'data-table': LazyDataTable,

  // File Operations
  'file-upload': LazyFileUpload,
  'export-dialog': LazyExportDialog,
  'pdf-viewer': LazyPDFViewer,

  // System Management
  'system-management': LazySystemManagement,
  'settings-panel': LazySettingsPanel,
  'bulk-operations': LazyBulkOperations,

  // Views & Navigation
  'history-view': LazyHistoryView,
  'map-view': LazyMapView,

  // UI Components
  'modal': LazyModal,
  'tooltip': LazyTooltip,
  'notification-center': LazyNotificationCenter,

  // Form Components
  'date-picker': LazyDatePicker,
  'location-picker': LazyLocationPicker,
  'advanced-filters': LazyAdvancedFilters,

  // Editors
  'markdown-editor': LazyMarkdownEditor,
  'code-editor': LazyCodeEditor,

  // Admin Components
  'admin-dashboard': LazyAdminDashboard,
  'user-management': LazyUserManagement,
  'system-metrics': LazySystemMetrics,
};

// Dynamic component loader
export const loadComponent = (componentKey: string) => {
  const Component = LAZY_COMPONENT_REGISTRY[componentKey as keyof typeof LAZY_COMPONENT_REGISTRY];
  if (!Component) {
    console.warn(`Component "${componentKey}" not found in registry`);
    return null;
  }
  return Component;
};

export default {
  // Export all lazy components
  ...LAZY_COMPONENT_REGISTRY,

  // Export utilities
  preloadComponents,
  preloadOnInteraction,
  loadComponent,
  PRELOAD_CONFIG,
};