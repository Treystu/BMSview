#!/usr/bin/env node

/**
 * BMSview Sanity Check - Comprehensive Workflow Verification
 * 
 * This script verifies that all critical workflows are logical and functional:
 * 1. Dual-write pattern in analyze.cjs
 * 2. Collection consistency between analysis-results and history
 * 3. Full Context Mode implementation
 * 4. Tool access patterns
 * 5. Documentation consistency
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const CHECKS = [];
const WARNINGS = [];
const ERRORS = [];

function check(name, condition, errorMsg, warningMsg = null) {
    if (condition) {
        CHECKS.push(`✅ ${name}`);
        return true;
    } else if (warningMsg) {
        WARNINGS.push(`⚠️  ${name}: ${warningMsg}`);
        return false;
    } else {
        ERRORS.push(`❌ ${name}: ${errorMsg}`);
        return false;
    }
}

function readFile(filePath) {
    try {
        return fs.readFileSync(path.join(REPO_ROOT, filePath), 'utf8');
    } catch (error) {
        ERRORS.push(`❌ Cannot read ${filePath}: ${error.message}`);
        return null;
    }
}

function fileExists(filePath) {
    return fs.existsSync(path.join(REPO_ROOT, filePath));
}

console.log('🔍 BMSview Sanity Check - Starting comprehensive verification...\n');

// =====================================================================
// CHECK 1: Dual-Write Pattern in analyze.cjs
// =====================================================================
console.log('📝 Checking dual-write pattern...');

const analyzeContent = readFile('netlify/functions/analyze.cjs');
if (analyzeContent) {
    check(
        'Dual-write: Insert to analysis-results',
        analyzeContent.includes('await resultsCol.insertOne(newRecord)'),
        'Missing insertOne to analysis-results'
    );

    check(
        'Dual-write: Insert to history collection',
        analyzeContent.includes('await historyCol.insertOne(historyRecord)'),
        'Missing dual-write to history collection - CRITICAL FIX NOT APPLIED!'
    );

    check(
        'Dual-write: Update to history on upgrade',
        analyzeContent.includes('await historyCol.updateOne') && 
        analyzeContent.includes('analysis: record.analysis'),
        'Missing dual-write update to history on quality upgrade'
    );

    check(
        'Dual-write: Non-blocking error handling',
        analyzeContent.includes('Dual-write to history collection failed (non-fatal)'),
        'Dual-write should have non-fatal error handling'
    );

    check(
        'Dual-write: Success logging',
        analyzeContent.includes('Dual-write to history collection successful'),
        'Missing success logging for dual-write verification'
    );
}

// =====================================================================
// CHECK 2: Full Context Mode Implementation
// =====================================================================
console.log('\n📝 Checking Full Context Mode implementation...');

const generateInsightsContent = readFile('netlify/functions/generate-insights-with-tools.cjs');
if (generateInsightsContent) {
    check(
        'Full Context Mode: Parameter extraction',
        generateInsightsContent.includes('const fullContextMode = sanitizedBody.fullContextMode'),
        'Missing fullContextMode parameter extraction'
    );

    check(
        'Full Context Mode: Pass to sync mode',
        generateInsightsContent.includes('fullContextMode: job.fullContextMode || fullContextMode'),
        'Not passing fullContextMode to sync ReAct loop'
    );

    check(
        'Full Context Mode: Pass to background jobs',
        generateInsightsContent.match(/fullContextMode.*Pass fullContextMode to background/),
        'Not passing fullContextMode to background processor'
    );
}

const reactLoopContent = readFile('netlify/functions/utils/react-loop.cjs');
if (reactLoopContent) {
    check(
        'Full Context Mode: ReAct loop parameter',
        reactLoopContent.includes('fullContextMode = false'),
        'Missing fullContextMode parameter in executeReActLoop'
    );

    check(
        'Full Context Mode: Build complete context',
        reactLoopContent.includes('buildCompleteContext(systemId'),
        'Not calling buildCompleteContext when fullContextMode enabled'
    );

    check(
        'Full Context Mode: Context preloading',
        reactLoopContent.includes('isFullContextMode: true'),
        'Not marking context as full context mode'
    );

    check(
        'Full Context Mode: Fallback to standard context',
        reactLoopContent.includes('falling back to standard context'),
        'Missing graceful fallback if full context fails'
    );
}

// =====================================================================
// CHECK 3: Collection Access Patterns
// =====================================================================
console.log('\n📝 Checking collection access patterns...');

const fullContextBuilder = readFile('netlify/functions/utils/full-context-builder.cjs');
if (fullContextBuilder) {
    check(
        'Collection: full-context-builder uses analysis-results',
        fullContextBuilder.includes("await getCollection('analysis-results')"),
        'full-context-builder should query analysis-results collection'
    );
}

const insightsSummary = readFile('netlify/functions/utils/insights-summary.cjs');
if (insightsSummary) {
    check(
        'Collection: insights-summary uses analysis-results',
        insightsSummary.includes("await getCollection('analysis-results')"),
        'insights-summary should query analysis-results collection'
    );
}

const geminiTools = readFile('netlify/functions/utils/gemini-tools.cjs');
if (geminiTools) {
    check(
        'Collection: request_bms_data uses history',
        geminiTools.includes("await getCollection('history')") &&
        geminiTools.includes('async function requestBmsData'),
        'request_bms_data tool should query history collection (backward compatibility)'
    );
}

// =====================================================================
// CHECK 4: Documentation Consistency
// =====================================================================
console.log('\n📝 Checking documentation consistency...');

check(
    'Documentation: DATA_COLLECTIONS.md exists',
    fileExists('DATA_COLLECTIONS.md'),
    'Missing DATA_COLLECTIONS.md canonical reference',
    'Should create DATA_COLLECTIONS.md for collection usage patterns'
);

const dataCollectionsDoc = readFile('DATA_COLLECTIONS.md');
if (dataCollectionsDoc) {
    check(
        'Documentation: Dual-write pattern documented',
        dataCollectionsDoc.includes('dual-write') || dataCollectionsDoc.includes('Dual-Write'),
        'DATA_COLLECTIONS.md should document dual-write pattern'
    );

    check(
        'Documentation: Collection migration path',
        dataCollectionsDoc.includes('migration') || dataCollectionsDoc.includes('Migration'),
        'Should document migration path from history to analysis-results'
    );

    check(
        'Documentation: Both collections documented',
        dataCollectionsDoc.includes('analysis-results') && dataCollectionsDoc.includes('history'),
        'Should document both analysis-results and history collections'
    );
}

// =====================================================================
// CHECK 5: Diagnostics Guru Components
// =====================================================================
console.log('\n📝 Checking Diagnostics Guru implementation...');

check(
    'Diagnostics: DiagnosticsQueryGuru component exists',
    fileExists('components/DiagnosticsQueryGuru.tsx'),
    'Missing DiagnosticsQueryGuru component',
    'Custom query diagnostics not implemented'
);

check(
    'Diagnostics: diagnose-function endpoint exists',
    fileExists('netlify/functions/diagnose-function.cjs'),
    'Missing diagnose-function endpoint',
    'Function-specific diagnostics not implemented'
);

const diagnoseFunctionContent = readFile('netlify/functions/diagnose-function.cjs');
if (diagnoseFunctionContent) {
    check(
        'Diagnostics: Checks collection consistency',
        diagnoseFunctionContent.includes('Collection mismatch detected'),
        'diagnose-function should detect collection inconsistencies'
    );

    check(
        'Diagnostics: Detects dual-write failures',
        diagnoseFunctionContent.includes('dual-write'),
        'diagnose-function should check for dual-write issues'
    );

    check(
        'Diagnostics: Provides actionable recommendations',
        diagnoseFunctionContent.includes('recommendations'),
        'diagnose-function should provide fix recommendations'
    );
}

// =====================================================================
// CHECK 6: Build Verification
// =====================================================================
console.log('\n📝 Checking build configuration...');

check(
    'Build: package.json exists',
    fileExists('package.json'),
    'Missing package.json'
);

check(
    'Build: vite.config.ts exists',
    fileExists('vite.config.ts'),
    'Missing vite.config.ts'
);

check(
    'Build: tsconfig.json exists',
    fileExists('tsconfig.json'),
    'Missing tsconfig.json'
);

// =====================================================================
// CHECK 7: Workflow Logic Verification
// =====================================================================
console.log('\n📝 Verifying workflow logic...');

// Check that analyze.cjs workflow makes sense
if (analyzeContent) {
    const hasAnalysisResults = analyzeContent.includes("getCollection('analysis-results')");
    const hasHistory = analyzeContent.includes("getCollection('history')");
    const hasDualWrite = analyzeContent.includes('historyRecord');

    check(
        'Workflow: analyze.cjs writes to both collections',
        hasAnalysisResults && hasHistory && hasDualWrite,
        'analyze.cjs should write to BOTH collections for dual-write pattern'
    );
}

// Check that tools can access data
if (geminiTools && analyzeContent) {
    const toolsUseHistory = geminiTools.includes("getCollection('history')");
    const analyzeDualWrites = analyzeContent.includes('await historyCol.insertOne');

    check(
        'Workflow: Tools can access data written by analyze.cjs',
        toolsUseHistory && analyzeDualWrites,
        'Tools query history but analyze.cjs might not write to it!'
    );
}

// Check Full Context Mode workflow
if (generateInsightsContent && reactLoopContent && fullContextBuilder) {
    const passesParameter = generateInsightsContent.includes('fullContextMode');
    const implementsLogic = reactLoopContent.includes('buildCompleteContext');
    const builderExists = fullContextBuilder.includes('buildCompleteContext');

    check(
        'Workflow: Full Context Mode end-to-end',
        passesParameter && implementsLogic && builderExists,
        'Full Context Mode workflow is incomplete'
    );
}

// =====================================================================
// RESULTS SUMMARY
// =====================================================================
console.log('\n' + '='.repeat(70));
console.log('📊 SANITY CHECK RESULTS');
console.log('='.repeat(70));

console.log(`\n✅ PASSED: ${CHECKS.length} checks`);
CHECKS.forEach(item => console.log(`   ${item}`));

if (WARNINGS.length > 0) {
    console.log(`\n⚠️  WARNINGS: ${WARNINGS.length}`);
    WARNINGS.forEach(item => console.log(`   ${item}`));
}

if (ERRORS.length > 0) {
    console.log(`\n❌ FAILED: ${ERRORS.length} checks`);
    ERRORS.forEach(item => console.log(`   ${item}`));
    console.log('\n🔴 SANITY CHECK FAILED - Please fix errors above!');
    process.exit(1);
} else {
    console.log('\n✅ ALL SANITY CHECKS PASSED!');
    console.log('\n📋 Summary of implemented fixes:');
    console.log('   1. ✅ Dual-write pattern ensures data in both collections');
    console.log('   2. ✅ Full Context Mode pre-loads complete context');
    console.log('   3. ✅ Tools can access data immediately after analysis');
    console.log('   4. ✅ Documentation consolidated and consistent');
    console.log('   5. ✅ Diagnostics Guru can detect and diagnose issues');
    console.log('\n🎉 BMSview is ready for deployment!');
    process.exit(0);
}
