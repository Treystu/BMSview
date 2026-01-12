/**
 * Batch script to add unified logging to all Netlify functions
 * 
 * This script adds the createForwardingLogger import and initialization
 * to all functions that have an exports.handler but don't already have it.
 * 
 * Run with: node netlify/functions/batch-add-logging.cjs
 */

const fs = require('fs');
const path = require('path');

const FUNCTIONS_DIR = path.join(__dirname);

// Files to skip (already handled or special cases)
const SKIP_FILES = new Set([
    'log-collector.cjs',
    'logs.cjs',
    'batch-add-logging.cjs'
]);

// Pattern to detect existing logger imports
const LOGGER_IMPORT_PATTERN = /const\s*\{[^}]*createLogger[^}]*\}\s*=\s*require\(['"`]\.\/utils\/logger\.cjs['"`]\);?/;

// Pattern to detect handler function
const HANDLER_PATTERN = /exports\.handler\s*=\s*async\s*function\s*\([^)]*\)\s*\{/;

// Pattern to detect existing forwarding logger
const FORWARDING_PATTERN = /createForwardingLogger/;

function addLoggingToFunction(filePath) {
    const fileName = path.basename(filePath);

    if (SKIP_FILES.has(fileName)) {
        console.log(`Skipping ${fileName} (in skip list)`);
        return;
    }

    const content = fs.readFileSync(filePath, 'utf8');

    if (FORWARDING_PATTERN.test(content)) {
        console.log(`Skipping ${fileName} (already has forwarding logger)`);
        return;
    }

    if (!HANDLER_PATTERN.test(content)) {
        console.log(`Skipping ${fileName} (no handler found)`);
        return;
    }

    console.log(`Processing ${fileName}...`);

    let modified = content;

    // Add import after logger import
    if (LOGGER_IMPORT_PATTERN.test(content)) {
        modified = modified.replace(
            LOGGER_IMPORT_PATTERN,
            (match) => match + '\nconst { createForwardingLogger } = require(\'./utils/log-forwarder.cjs\');'
        );
    } else {
        // If no logger import, add after other requires
        const requirePattern = /require\(['"`][^'"`]+['"`]\);?/g;
        const requires = [...content.matchAll(requirePattern)];
        if (requires.length > 0) {
            const lastRequire = requires[requires.length - 1][0];
            modified = modified.replace(
                lastRequire,
                lastRequire + '\nconst { createForwardingLogger } = require(\'./utils/log-forwarder.cjs\');'
            );
        }
    }

    // Add forwarding logger initialization in handler
    modified = modified.replace(
        HANDLER_PATTERN,
        (match) => {
            // Find the logger initialization within the handler
            const handlerStart = content.indexOf(match);
            const handlerContent = content.slice(handlerStart);

            // Look for logger creation pattern
            const loggerInitPattern = /const\s+log\s*=\s*createLoggerFromEvent\([^)]+\);?/;
            const loggerMatch = handlerContent.match(loggerInitPattern);

            if (loggerMatch) {
                return match + handlerContent.replace(
                    loggerMatch[0],
                    loggerMatch[0] + '\n\n  // Unified logging: also forward to centralized collector\n  const forwardLog = createForwardingLogger(\'' + fileName.replace('.cjs', '') + '\');'
                );
            }

            return match;
        }
    );

    if (modified !== content) {
        fs.writeFileSync(filePath, modified);
        console.log(`✓ Updated ${fileName}`);
    } else {
        console.log(`⚠ No changes made to ${fileName}`);
    }
}

// Process all .cjs files
const files = fs.readdirSync(FUNCTIONS_DIR)
    .filter(f => f.endsWith('.cjs'))
    .map(f => path.join(FUNCTIONS_DIR, f));

console.log(`Found ${files.length} .cjs files\n`);

files.forEach(addLoggingToFunction);

console.log('\nBatch update complete!');
console.log('Run `npm run lint` to check for any issues.');
