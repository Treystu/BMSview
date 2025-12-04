/**
 * Database Index Creation Script
 * Run this script to create optimized indexes for BMSview collections
 * 
 * Usage: node scripts/create-indexes.js
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'bmsview';

const INDEXES = {
    'analysis-results': [
        {
            key: { contentHash: 1 },
            options: { 
                name: 'idx_analysis_content_hash',
                unique: true,
                background: true,
                sparse: true // Allow null values for old records
            }
        },
        {
            key: { timestamp: 1 },
            options: { 
                name: 'idx_analysis_timestamp',
                background: true 
            }
        },
        {
            key: { updatedAt: 1 },
            options: { 
                name: 'idx_analysis_updated',
                background: true 
            }
        },
        {
            key: { systemId: 1, timestamp: -1 },
            options: { 
                name: 'idx_analysis_system_timestamp',
                background: true,
                sparse: true
            }
        },
        {
            key: { 'analysis.dlNumber': 1 },
            options: { 
                name: 'idx_analysis_dlnumber',
                background: true,
                sparse: true
            }
        }
    ],
    jobs: [
        {
            key: { id: 1 },
            options: { 
                name: 'idx_jobs_id',
                unique: true,
                background: true 
            }
        },
        {
            key: { status: 1, createdAt: 1 },
            options: { 
                name: 'idx_jobs_status_created',
                background: true 
            }
        },
        {
            key: { nextRetryAt: 1 },
            options: { 
                name: 'idx_jobs_next_retry',
                background: true,
                sparse: true
            }
        },
        {
            key: { lastHeartbeat: 1 },
            options: { 
                name: 'idx_jobs_heartbeat',
                background: true 
            }
        },
        {
            key: { createdAt: 1 },
            options: { 
                name: 'idx_jobs_created',
                background: true,
                expireAfterSeconds: 604800 // 7 days TTL
            }
        }
    ],
    history: [
        {
            key: { id: 1 },
            options: { 
                name: 'idx_history_id',
                unique: true,
                background: true 
            }
        },
        {
            key: { fileName: 1, analysisKey: 1 },
            options: { 
                name: 'idx_history_filename_key',
                background: true 
            }
        },
        {
            key: { dlNumber: 1 },
            options: { 
                name: 'idx_history_dlnumber',
                background: true,
                sparse: true
            }
        },
        {
            key: { systemId: 1 },
            options: { 
                name: 'idx_history_system',
                background: true,
                sparse: true
            }
        },
        {
            key: { timestamp: -1 },
            options: { 
                name: 'idx_history_timestamp',
                background: true 
            }
        }
    ],
    systems: [
        {
            key: { id: 1 },
            options: { 
                name: 'idx_systems_id',
                unique: true,
                background: true 
            }
        },
        {
            key: { dlNumber: 1 },
            options: { 
                name: 'idx_systems_dlnumber',
                background: true,
                sparse: true
            }
        }
    ]
};

async function createIndexes() {
    console.log('Starting index creation...');
    console.log(`Connecting to: ${MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`);
    
    let client;
    
    try {
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log('Connected to MongoDB');
        
        const db = client.db(MONGODB_DB);
        console.log(`Using database: ${MONGODB_DB}\n`);
        
        for (const [collectionName, indexes] of Object.entries(INDEXES)) {
            console.log(`\n=== Creating indexes for collection: ${collectionName} ===`);
            const collection = db.collection(collectionName);
            
            // Get existing indexes
            const existingIndexes = await collection.indexes();
            const existingIndexNames = new Set(existingIndexes.map(idx => idx.name));
            
            console.log(`Existing indexes: ${existingIndexNames.size}`);
            existingIndexes.forEach(idx => {
                console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
            });
            
            // Create new indexes
            for (const indexSpec of indexes) {
                const indexName = indexSpec.options.name;
                
                if (existingIndexNames.has(indexName)) {
                    console.log(`\n✓ Index "${indexName}" already exists, skipping`);
                    continue;
                }
                
                try {
                    console.log(`\nCreating index "${indexName}"...`);
                    console.log(`  Key: ${JSON.stringify(indexSpec.key)}`);
                    console.log(`  Options: ${JSON.stringify(indexSpec.options)}`);
                    
                    await collection.createIndex(indexSpec.key, indexSpec.options);
                    console.log(`✓ Successfully created index "${indexName}"`);
                } catch (error) {
                    console.error(`✗ Failed to create index "${indexName}":`, error.message);
                }
            }
        }
        
        console.log('\n=== Index creation completed ===\n');
        
        // Display final index summary
        console.log('Final index summary:');
        for (const collectionName of Object.keys(INDEXES)) {
            const collection = db.collection(collectionName);
            const indexes = await collection.indexes();
            console.log(`\n${collectionName}: ${indexes.length} indexes`);
            indexes.forEach(idx => {
                console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
            });
        }
        
    } catch (error) {
        console.error('Error creating indexes:', error);
        process.exit(1);
    } finally {
        if (client) {
            await client.close();
            console.log('\nDisconnected from MongoDB');
        }
    }
}

// Run the script
createIndexes()
    .then(() => {
        console.log('\n✓ All done!');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n✗ Script failed:', error);
        process.exit(1);
    });