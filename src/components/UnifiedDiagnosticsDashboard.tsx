import React, { useState } from "react";
import {
  UNIFIED_DIAGNOSTIC_CATEGORIES,
  ALL_UNIFIED_TESTS,
} from "@/constants/unified-diagnostics";
import type { AdminAction, AdminState } from "@/state/adminState";
import { runUnifiedDiagnostics } from "@/services/clientService";
import SpinnerIcon from "./icons/SpinnerIcon";

interface UnifiedDiagnosticsDashboardProps {
  state: AdminState;
  dispatch: React.Dispatch<AdminAction>;
}

interface UnifiedResult {
  testId: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED" | "RUNNING";
  duration: number;
  details?: unknown;
  error?: { message: string; stack: string };
  aiPrompt?: string;
}

const UnifiedDiagnosticsDashboard: React.FC<
  UnifiedDiagnosticsDashboardProps
> = ({ state: _state, dispatch: _dispatch }) => {
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [selectedTests, setSelectedTests] = useState<Set<string>>(
    new Set(ALL_UNIFIED_TESTS.map((t) => t.id)),
  );
  const [testResults, setTestResults] = useState<Record<string, UnifiedResult>>(
    {},
  );
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Filtering logic
  const filteredTests = ALL_UNIFIED_TESTS.filter((test) => {
    const categoryMatch =
      selectedCategory === "All" || test.category === selectedCategory;
    const searchMatch =
      test.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      test.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      test.id.toLowerCase().includes(searchQuery.toLowerCase());
    return categoryMatch && searchMatch;
  });

  const toggleTest = (testId: string) => {
    const newSelected = new Set(selectedTests);
    if (newSelected.has(testId)) newSelected.delete(testId);
    else newSelected.add(testId);
    setSelectedTests(newSelected);
  };

  const selectAllFiltered = () => {
    const newSelected = new Set(selectedTests);
    filteredTests.forEach((t) => newSelected.add(t.id));
    setSelectedTests(newSelected);
  };

  const deselectAllFiltered = () => {
    const newSelected = new Set(selectedTests);
    filteredTests.forEach((t) => newSelected.delete(t.id));
    setSelectedTests(newSelected);
  };

  const runSelectedTests = async () => {
    if (isOrchestrating) return;
    setIsOrchestrating(true);

    // Reset results for selected
    const initialResults = { ...testResults };
    Array.from(selectedTests).forEach((tid) => {
      initialResults[tid] = { testId: tid, status: "RUNNING", duration: 0 };
    });
    setTestResults(initialResults);

    try {
      // Run in batches of categories to avoid massive payload/timeout
      const categoriesToRun =
        selectedCategory === "All"
          ? UNIFIED_DIAGNOSTIC_CATEGORIES
          : [selectedCategory];

      for (const cat of categoriesToRun) {
        const testsInCat = ALL_UNIFIED_TESTS.filter(
          (t) => t.category === cat && selectedTests.has(t.id),
        );
        if (testsInCat.length === 0) continue;

        // Update UI to show we are hitting this category
        console.log(`Running unified diagnostics for category: ${cat}`);

        const response = await runUnifiedDiagnostics({
          category: cat,
          params: { tests: testsInCat.map((t) => t.id) },
        });

        const updatedResults = { ...testResults };
        response.results.forEach((res) => {
          updatedResults[res.testId] = {
            testId: res.testId,
            status: res.status as UnifiedResult["status"],
            duration: res.duration,
            details: res.details,
            error: res.error,
            aiPrompt: res.aiPrompt,
          };
        });
        setTestResults((prev) => ({ ...prev, ...updatedResults }));
      }
    } catch (err) {
      console.error("Unified diagnostics orchestration failed", err);
    } finally {
      setIsOrchestrating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("AI Prompt copied to clipboard!");
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "SUCCESS":
        return "text-green-400";
      case "FAILED":
        return "text-red-400";
      case "RUNNING":
        return "text-blue-400";
      default:
        return "text-gray-400";
    }
  };

  const getStatusBg = (status: string) => {
    switch (status) {
      case "SUCCESS":
        return "bg-green-900/20 border-green-500/30";
      case "FAILED":
        return "bg-red-900/20 border-red-500/30";
      case "RUNNING":
        return "bg-blue-900/20 border-blue-500/30";
      default:
        return "bg-gray-800/50 border-gray-700";
    }
  };

  const stats = {
    total: selectedTests.size,
    passed: Object.values(testResults).filter(
      (r) => selectedTests.has(r.testId) && r.status === "SUCCESS",
    ).length,
    failed: Object.values(testResults).filter(
      (r) => selectedTests.has(r.testId) && r.status === "FAILED",
    ).length,
    running: Object.values(testResults).filter(
      (r) => selectedTests.has(r.testId) && r.status === "RUNNING",
    ).length,
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-700 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <span className="text-blue-500">Unified</span> Diagnostics Dashboard
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Running 86 comprehensive tests across all system layers.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={runSelectedTests}
            disabled={isOrchestrating || selectedTests.size === 0}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-2 px-6 rounded-lg transition-all shadow-lg flex items-center gap-2"
          >
            {isOrchestrating ? <SpinnerIcon className="w-4 h-4" /> : "🚀"}
            {isOrchestrating
              ? "Testing Everything..."
              : `Test ${selectedTests.size} Selected`}
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Total Selected",
            value: stats.total,
            color: "text-gray-300",
          },
          { label: "Passed", value: stats.passed, color: "text-green-400" },
          { label: "Failed", value: stats.failed, color: "text-red-400" },
          {
            label: "Pending/Running",
            value: stats.running,
            color: "text-blue-400",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-gray-800/80 p-4 rounded-xl border border-gray-700 shadow-sm text-center"
          >
            <div className={`text-2xl font-bold ${stat.color}`}>
              {stat.value}
            </div>
            <div className="text-xs text-gray-400 uppercase tracking-wider mt-1">
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Filters & Search */}
      <div className="bg-gray-800/40 p-4 rounded-xl border border-gray-700 space-y-4">
        <div className="flex flex-wrap gap-2">
          <button
            key="All"
            onClick={() => setSelectedCategory("All")}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${selectedCategory === "All" ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
          >
            All Categories
          </button>
          {UNIFIED_DIAGNOSTIC_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${selectedCategory === cat ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
            >
              {cat}
            </button>
          ))}
        </div>
        <div className="flex flex-col md:flex-row gap-4">
          <input
            type="text"
            placeholder="Search tests, files, or descriptions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          />
          <div className="flex gap-2">
            <button
              onClick={selectAllFiltered}
              className="text-xs px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
            >
              Select Visible
            </button>
            <button
              onClick={deselectAllFiltered}
              className="text-xs px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
            >
              Deselect Visible
            </button>
          </div>
        </div>
      </div>

      {/* Test List */}
      <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
        {filteredTests.map((test) => {
          const result = testResults[test.id];
          const isSelected = selectedTests.has(test.id);
          const isExpanded = expandedTestId === test.id;

          return (
            <div
              key={test.id}
              className={`group border rounded-xl p-4 transition-all ${getStatusBg(result?.status || "IDLE")} ${!isSelected ? "opacity-50 grayscale-[0.5]" : ""}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleTest(test.id)}
                    className="mt-1.5 w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500/50"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-white group-hover:text-blue-400 transition-colors uppercase tracking-tight text-sm">
                        {test.label}
                      </h4>
                      <span className="text-[10px] bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded uppercase font-bold">
                        {test.category}
                      </span>
                      {result && (
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${getStatusColor(result.status)} bg-black/20`}
                        >
                          {result.status}{" "}
                          {result.duration > 0 && `(${result.duration}ms)`}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                      {test.description}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(result?.details || result?.error || result?.aiPrompt) && (
                    <button
                      onClick={() =>
                        setExpandedTestId(isExpanded ? null : test.id)
                      }
                      className="text-xs text-gray-400 hover:text-white bg-gray-700/50 hover:bg-gray-700 px-2 py-1 rounded transition-colors"
                    >
                      {isExpanded ? "Collapse" : "Details"}
                    </button>
                  )}
                </div>
              </div>

              {isExpanded && result && (
                <div className="mt-4 pt-4 border-t border-gray-700/50 space-y-4 animate-in slide-in-from-top-2 duration-300">
                  {result.error && (
                    <div className="bg-red-900/40 border border-red-500/30 p-3 rounded-lg">
                      <div className="text-[10px] font-bold text-red-400 uppercase mb-2">
                        Error Logs
                      </div>
                      <pre className="text-xs text-red-200 whitespace-pre-wrap break-all font-mono opacity-80">
                        {result.error.stack || result.error.message}
                      </pre>
                    </div>
                  )}
                  {!!result.details && (
                    <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-700">
                      <div className="text-[10px] font-bold text-gray-400 uppercase mb-2">
                        Test Details / Data
                      </div>
                      <pre className="text-[11px] text-gray-300 font-mono">
                        {JSON.stringify(result.details, null, 2)}
                      </pre>
                    </div>
                  )}
                  {result.status === "FAILED" && result.aiPrompt && (
                    <div className="bg-blue-900/30 border border-blue-500/30 p-4 rounded-xl relative overflow-hidden group/prompt">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-blue-400">🤖</span>
                          <h5 className="text-sm font-bold text-blue-300 uppercase tracking-wide">
                            AI-Ready Resolution Prompt
                          </h5>
                        </div>
                        <button
                          onClick={() => copyToClipboard(result.aiPrompt!)}
                          className="text-[10px] font-bold bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-full transition-all shadow-md active:scale-95 flex items-center gap-1.5"
                        >
                          📋 Copy for AI Agent
                        </button>
                      </div>
                      <div className="bg-black/40 p-3 rounded-lg text-xs font-mono text-gray-400 line-clamp-6 leading-relaxed border border-blue-500/10 italic">
                        {result.aiPrompt}
                      </div>
                      <div className="mt-3 flex items-center gap-2 text-[10px] text-blue-400/60 font-medium italic">
                        <span>
                          TIP: Copy this prompt and paste it to an AI Agent to
                          fix the issue automatically.
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default UnifiedDiagnosticsDashboard;
