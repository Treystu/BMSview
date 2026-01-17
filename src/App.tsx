import { useCallback, useEffect, useMemo } from "react";

// DEBUG: Add visibility to track bundle loading issues
console.warn("[BUNDLE-DEBUG] App.tsx module executed", {
  timestamp: new Date().toISOString(),
  pathname: typeof window !== "undefined" ? window.location.pathname : "N/A",
  stack: new Error().stack,
});

import AnalysisResult from "./components/AnalysisResult";
import Footer from "./components/Footer";
import Header from "./components/Header";
import RegisterBms from "./components/RegisterBms";
import UploadSection from "./components/UploadSection";
// ***MODIFIED***: Import the new *synchronous* service
import type { SyncEvent } from "@/services/syncManager";
import { getSyncManager } from "@/services/syncManager";

import {
  associateHardwareIdToSystem,
  getAnalysisHistory,
  getRegisteredSystems,
  linkAnalysisToSystem,
  registerBmsSystem,
} from "./services/clientService";
import { analyzeBmsScreenshot } from "./services/geminiService";
import { useAppState } from "./state/appState";
import type {
  AnalysisData,
  AnalysisRecord,
  BmsSystem,
  DisplayableAnalysisResult,
} from "@/types";
import {
  buildRecordFromCachedDuplicate,
  checkFilesForDuplicates,
  EMPTY_CATEGORIZATION,
  partitionCachedFiles,
  type DuplicateCheckResult,
} from "./utils/duplicateChecker";
import { safeGetItems } from "./utils/stateHelpers";
import UploadOptimizer from "./utils/uploadOptimizer";
// ***REMOVED***: No longer need job polling
// import { getIsActualError } from './utils';

const log = (level: string, message: string, context?: unknown) => {
  console.log(
    JSON.stringify({
      level: level.toUpperCase(),
      timestamp: new Date().toISOString(),
      service: "app-ui",
      message,
      context,
    }),
  );
};

// Guard to prevent rapid-fire refreshes (e.g. during bulk sync)
let lastRefreshTime = 0;
const REFRESH_THROTTLE_MS = 5000;

function App() {
  const { state, dispatch } = useAppState();
  const {
    analysisResults,
    isLoading,
    error,
    isRegistering,
    registrationError,
    registrationSuccess,
    isRegisterModalOpen,
    registrationContext,
  } = state;

  // Initialize optimizer for parallel analysis
  const optimizer = useMemo(() => new UploadOptimizer(), []);

  const fetchAppData = useCallback(
    async (isManual = true) => {
      // Only throttle background refreshes from sync events, not manual/initial
      if (!isManual) {
        const now = Date.now();
        if (now - lastRefreshTime < REFRESH_THROTTLE_MS) {
          log("debug", "Throttling background data refresh.", {
            lastRefresh: lastRefreshTime,
          });
          return;
        }
        lastRefreshTime = now;
      }

      log("info", "Fetching application data.", { isManual });
      try {
        const [systems, history] = await Promise.all([
          getRegisteredSystems(1, 1000), // Load all systems for linking
          getAnalysisHistory(1, 25), // Load first page of history
        ]);
        dispatch({ type: "FETCH_DATA_SUCCESS", payload: { systems, history } });
      } catch (error) {
        log("error", "Failed to fetch initial data", { error });
        dispatch({
          type: "SET_ERROR",
          payload: "Failed to load application data.",
        });
      }
    },
    [dispatch],
  );

  // Guard: Do not initialize main app logic on admin page
  const isAdminPage = window.location.pathname.includes("/admin.html");

  useEffect(() => {
    if (isAdminPage) {
      log("info", "Detected admin page - skipping main app initialization");
      return;
    }

    fetchAppData(true); // Initial load is manual (unthrottled)

    // Subscribe to SyncManager events
    const syncManager = getSyncManager();
    const unsubscribe = syncManager.subscribe((event: SyncEvent) => {
      switch (event.type) {
        case "sync-start":
          dispatch({
            type: "UPDATE_SYNC_STATUS",
            payload: { isSyncing: true },
          });
          break;
        case "sync-complete":
          dispatch({
            type: "UPDATE_SYNC_STATUS",
            payload: {
              isSyncing: false,
              lastSyncTime: syncManager.getSyncStatus().lastSyncTime,
            },
          });
          break;
        case "sync-error":
          dispatch({ type: "SYNC_ERROR", payload: event.error });
          dispatch({
            type: "UPDATE_SYNC_STATUS",
            payload: { isSyncing: false },
          }); // Ensure we stop spinning
          break;
        case "drift-warning":
          log("warn", `Time drift detected: ${event.diff}ms`);
          break;
        case "data-changed":
          log("info", "Data changed via sync, refreshing app data", {
            collection: event.collection,
          });
          fetchAppData(false); // Background refresh is throttled
          break;
      }
    });

    // Start periodic sync on mount
    syncManager.startPeriodicSync();

    // Cleanup on unmount
    return () => {
      unsubscribe();
      syncManager.stopPeriodicSync();
    };
  }, [fetchAppData, isAdminPage]);

  const handleLinkRecordToSystem = async (
    recordId: string,
    systemId: string,
    hardwareSystemId?: string | null,
  ) => {
    log("info", "Linking record to system.", { recordId, systemId });
    try {
      await linkAnalysisToSystem(recordId, systemId, hardwareSystemId);
      await fetchAppData(true);
      dispatch({ type: "UPDATE_RESULTS_AFTER_LINK" });
    } catch {
      dispatch({ type: "SET_ERROR", payload: "Failed to link the record." });
    }
  };

  const handleAnalyze = async (
    files: File[],
    options?: { forceFileName?: string; forceReanalysis?: boolean },
  ) => {
    log("info", "Analysis process initiated.", {
      fileCount: files.length,
      forceFileName: options?.forceFileName,
      forceReanalysis: options?.forceReanalysis,
    });

    if (files.length === 0) {
      dispatch({ type: "ANALYSIS_COMPLETE" });
      return;
    }

    const initialResults: DisplayableAnalysisResult[] = files.map((f) => ({
      fileName: f.name,
      data: null,
      error: "Checking for duplicates...",
      file: f,
      submittedAt: Date.now(),
    }));

    dispatch({ type: "PREPARE_ANALYSIS", payload: initialResults });
    setTimeout(
      () =>
        document
          .getElementById("results-section")
          ?.scrollIntoView({ behavior: "smooth" }),
      100,
    );

    try {
      let filesToAnalyze: { file: File; needsUpgrade?: boolean }[] = [];

      if (!options?.forceReanalysis) {
        try {
          const { cachedDuplicates, cachedUpgrades, remainingFiles } =
            partitionCachedFiles(files);
          const batchUpdates: Array<{
            fileName: string;
            record: AnalysisRecord;
            isDuplicate: boolean;
          }> = [];

          for (const dup of cachedDuplicates) {
            batchUpdates.push({
              fileName: dup.file.name,
              isDuplicate: true,
              record: buildRecordFromCachedDuplicate(dup, "local-duplicate"),
            });
          }

          const cachedUpgradeResults: DuplicateCheckResult[] =
            cachedUpgrades.map((file) => ({
              file,
              isDuplicate: true,
              needsUpgrade: true,
            }));

          const { trueDuplicates, needsUpgrade, newFiles } =
            remainingFiles.length > 0
              ? await checkFilesForDuplicates(remainingFiles, log)
              : EMPTY_CATEGORIZATION;

          const combinedNeedsUpgrade = [
            ...cachedUpgradeResults,
            ...needsUpgrade,
          ];

          for (const dup of trueDuplicates) {
            batchUpdates.push({
              fileName: dup.file.name,
              isDuplicate: true,
              record: {
                id: dup.recordId || `local-duplicate-${Date.now()}`,
                timestamp: dup.timestamp || new Date().toISOString(),
                analysis:
                  (dup.analysisData as AnalysisData | null | undefined) ?? null,
                fileName: dup.file.name,
              },
            });
          }

          // Dispatch all duplicates in one go
          if (batchUpdates.length > 0) {
            dispatch({
              type: "BATCH_ANALYSIS_COMPLETE",
              payload: batchUpdates,
            });
          }

          const statusUpdates = [
            ...combinedNeedsUpgrade.map((item) => ({
              fileName: item.file.name,
              status: "Queued (upgrading)",
            })),
            ...newFiles.map((item) => ({
              fileName: item.file.name,
              status: "Queued",
            })),
          ];

          if (statusUpdates.length > 0) {
            dispatch({
              type: "BATCH_UPDATE_ANALYSIS_STATUS",
              payload: statusUpdates,
            });
          }

          filesToAnalyze = [...combinedNeedsUpgrade, ...newFiles];

          log("info", "Phase 1 complete: Duplicate check finished.", {
            count: filesToAnalyze.length,
            upgrades: combinedNeedsUpgrade.length,
            new: newFiles.length,
            duplicates: trueDuplicates.length,
            cachedDuplicates: cachedDuplicates.length,
            cachedUpgrades: cachedUpgrades.length,
          });
        } catch (duplicateCheckError) {
          log(
            "warn",
            "Phase 1 failed: Duplicate check error, will analyze all files.",
            {
              error:
                duplicateCheckError instanceof Error
                  ? duplicateCheckError.message
                  : String(duplicateCheckError),
              fileCount: files.length,
            },
          );

          for (const file of files) {
            dispatch({
              type: "UPDATE_ANALYSIS_STATUS",
              payload: { fileName: file.name, status: "Queued" },
            });
          }

          filesToAnalyze = files.map((file) => ({ file }));
        }

        log(
          "info",
          "Phase 2: Starting parallel analysis of non-duplicate files.",
          {
            count: filesToAnalyze.length,
          },
        );

        // Define single-file processor for optimizer
        const processFile = async (item: { file: File }) => {
          const file = item.file;
          dispatch({
            type: "UPDATE_ANALYSIS_STATUS",
            payload: { fileName: file.name, status: "Processing" },
          });

          const analysisData = await analyzeBmsScreenshot(file, false);

          log("info", "Processing synchronous analysis result.", {
            fileName: file.name,
          });
          dispatch({
            type: "SYNC_ANALYSIS_COMPLETE",
            payload: {
              fileName: file.name,
              isDuplicate: false,
              record: {
                id: analysisData._recordId || `local-${Date.now()}`,
                timestamp: analysisData._timestamp || new Date().toISOString(),
                systemId: analysisData.systemId || undefined,
                hardwareSystemId: analysisData.hardwareSystemId,
                analysis: analysisData,
                fileName: file.name,
              },
            },
          });

          return analysisData; // Contains _meta.headers for optimizer
        };

        // Run with optimizer for parallel processing with rate-limit awareness
        const { errors } = await optimizer.processBatch(
          filesToAnalyze,
          processFile,
        );

        // Handle any errors that weren't caught per-file
        for (const { file, error } of errors) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          if (message.toLowerCase().includes("duplicate")) {
            dispatch({
              type: "SYNC_ANALYSIS_COMPLETE",
              payload: {
                fileName: file,
                isDuplicate: true,
                record: {
                  id: `local-duplicate-${Date.now()}`,
                  timestamp: new Date().toISOString(),
                  analysis: null,
                  fileName: file,
                },
              },
            });
          } else {
            dispatch({
              type: "UPDATE_ANALYSIS_STATUS",
              payload: { fileName: file, status: `Failed: ${message}` },
            });
          }
        }
      } else {
        log("info", "Force reanalysis mode - skipping duplicate check.", {
          fileCount: files.length,
        });

        for (const file of files) {
          try {
            dispatch({
              type: "UPDATE_ANALYSIS_STATUS",
              payload: { fileName: file.name, status: "Processing" },
            });
            const analysisData = await analyzeBmsScreenshot(file, true);

            log("info", "Processing synchronous analysis result.", {
              fileName: file.name,
            });
            dispatch({
              type: "SYNC_ANALYSIS_COMPLETE",
              payload: {
                fileName: file.name,
                isDuplicate: false,
                record: {
                  id: analysisData._recordId || `local-${Date.now()}`,
                  timestamp:
                    analysisData._timestamp || new Date().toISOString(),
                  systemId: analysisData.systemId || undefined,
                  hardwareSystemId: analysisData.hardwareSystemId,
                  analysis: analysisData,
                  fileName: file.name,
                },
              },
            });
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "An unknown error occurred.";
            log("error", "Analysis request failed for one file.", {
              error: message,
              fileName: file.name,
            });
            dispatch({
              type: "UPDATE_ANALYSIS_STATUS",
              payload: { fileName: file.name, status: `Failed: ${message}` },
            });
          }
        }
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error during analysis.";
      log("error", "Analysis process failed.", { error: errorMessage });
      dispatch({ type: "SET_ERROR", payload: errorMessage });
    }

    // Batch weather backfill: Fill weather gaps efficiently after analysis completes
    // This uses minimal API calls (1 call per day) rather than per-image calls
    // Get unique systemIds from recently analyzed records
    const historyItems = Array.isArray(state.analysisHistory)
      ? state.analysisHistory
      : state.analysisHistory.items || [];
    const recentSystemIds = new Set<string>();
    historyItems.slice(0, files.length).forEach((record: AnalysisRecord) => {
      if (record.systemId) recentSystemIds.add(record.systemId);
    });

    for (const systemId of recentSystemIds) {
      try {
        log("info", "Starting batch weather backfill for system.", {
          systemId,
        });
        const response = await fetch(
          "/.netlify/functions/weather-backfill-gaps",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ systemId }),
          },
        );
        if (response.ok) {
          const result = await response.json();
          log("info", "Weather backfill complete.", result);
        }
      } catch (weatherErr) {
        log("warn", "Weather backfill failed (non-blocking).", {
          error: weatherErr instanceof Error ? weatherErr.message : "Unknown",
        });
      }
    }

    dispatch({ type: "ANALYSIS_COMPLETE" });
  };

  const handleReprocess = async (fileToReprocess: File) => {
    log("info", "Reprocess initiated.", { fileName: fileToReprocess.name });
    await handleAnalyze([fileToReprocess], {
      forceFileName: fileToReprocess.name,
      forceReanalysis: true,
    });
  };

  const handleRegisterSystem = async (
    systemData: Omit<BmsSystem, "id" | "associatedHardwareIds">,
  ) => {
    dispatch({ type: "REGISTER_SYSTEM_START" });
    try {
      const newSystem = await registerBmsSystem({
        ...systemData,
        associatedHardwareIds: [],
      });
      if (registrationContext?.hardwareSystemId) {
        await associateHardwareIdToSystem(
          registrationContext.hardwareSystemId,
          newSystem.id,
        );
      }
      dispatch({
        type: "REGISTER_SYSTEM_SUCCESS",
        payload: `System "${newSystem.name}" registered!`,
      });
      await fetchAppData(true);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown registration error";
      dispatch({ type: "REGISTER_SYSTEM_ERROR", payload: errorMessage });
    }
  };

  const handleInitiateRegistration = (hardwareSystemId: string) => {
    dispatch({ type: "OPEN_REGISTER_MODAL", payload: { hardwareSystemId } });
  };

  const handleCloseRegisterModal = () => {
    dispatch({ type: "CLOSE_REGISTER_MODAL" });
  };

  // Guard: Do not render main app UI on admin page - return null to avoid covering admin dashboard
  if (isAdminPage) {
    return null;
  }

  return (
    <div className="flex flex-col min-h-screen bg-neutral-light">
      <Header />
      <main className="flex-grow">
        <UploadSection
          onAnalyze={handleAnalyze}
          isLoading={isLoading}
          error={error}
          hasResults={analysisResults.length > 0}
        />
        {analysisResults.length > 0 && (
          <section id="results-section" className="py-20 bg-white">
            <div className="container mx-auto px-6 space-y-8">
              <h2 className="text-3xl font-bold text-center text-neutral-dark">
                Analysis Results
              </h2>
              {analysisResults.map((result) => (
                <AnalysisResult
                  key={result.fileName}
                  result={result}
                  registeredSystems={safeGetItems(state.registeredSystems)}
                  onLinkRecord={handleLinkRecordToSystem}
                  onReprocess={handleReprocess}
                  onRegisterNewSystem={handleInitiateRegistration}
                />
              ))}
            </div>
          </section>
        )}
      </main>
      <Footer />
      <RegisterBms
        onRegister={handleRegisterSystem}
        isRegistering={isRegistering}
        error={registrationError}
        successMessage={registrationSuccess}
        isOpen={isRegisterModalOpen}
        onClose={handleCloseRegisterModal}
      />
    </div>
  );
}

export default App;
