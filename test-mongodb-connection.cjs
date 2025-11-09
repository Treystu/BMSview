#!/usr/bin/env node
/**
 * MongoDB Connection Diagnostic Script
 * 
 * Tests MongoDB connectivity and provides detailed diagnostics
 * Usage: node test-mongodb-connection.cjs
 */

const { MongoClient } = require('mongodb');

// Try to load dotenv if available (optional)
try {
    require('dotenv').config();
} catch (e) {
    // dotenv not installed, use environment variables directly
}

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || 'bmsview';

console.log('\n🔍 MongoDB Connection Diagnostics\n');
console.log('Configuration:');
console.log(`  Database: ${DB_NAME}`);
console.log(`  URI Preview: ${MONGODB_URI ? MONGODB_URI.substring(0, 25) + '...' : 'NOT SET'}`);
console.log(`  Has URI: ${!!MONGODB_URI}\n`);

if (!MONGODB_URI) {
    console.error('❌ ERROR: MONGODB_URI environment variable is not set!');
    console.log('\nTo fix:');
    console.log('  1. Create .env file in project root');
    console.log('  2. Add: MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/');
    console.log('  3. Or set in Netlify dashboard: Site settings > Environment variables\n');
    process.exit(1);
}

async function testConnection() {
    let client;

    try {
        console.log('⏳ Connecting to MongoDB...\n');

        const startTime = Date.now();

        client = new MongoClient(MONGODB_URI, {
            tls: true,
            tlsAllowInvalidCertificates: false,
            tlsAllowInvalidHostnames: false,
            maxPoolSize: 5,
            minPoolSize: 1,
            maxIdleTimeMS: 60000,
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 10000,
            retryWrites: true,
            retryReads: true,
            keepAlive: true,
            keepAliveInitialDelay: 30000,
        });

        // Add event listeners
        client.on('connectionCreated', (event) => {
            console.log(`✅ Connection created: ${event.connectionId}`);
        });

        client.on('connectionClosed', (event) => {
            console.log(`⚠️  Connection closed: ${event.connectionId} - ${event.reason}`);
        });

        client.on('error', (error) => {
            console.error(`❌ Client error: ${error.message}`);
        });

        // Connect
        await client.connect();
        const connectTime = Date.now() - startTime;

        console.log(`✅ Connected successfully in ${connectTime}ms\n`);

        // Get database
        const db = client.db(DB_NAME);

        // Ping
        console.log('⏳ Pinging database...');
        await db.admin().ping();
        console.log('✅ Ping successful\n');

        // List collections
        console.log('⏳ Listing collections...');
        const collections = await db.listCollections().toArray();
        console.log(`✅ Found ${collections.length} collections:`);
        collections.forEach(col => console.log(`  - ${col.name}`));
        console.log('');

        // Test a simple query
        console.log('⏳ Testing query on "systems" collection...');
        const systemsCollection = db.collection('systems');
        const count = await systemsCollection.countDocuments();
        console.log(`✅ Found ${count} documents in systems collection\n`);

        // Check connection pool status
        const poolStats = client.topology?.s?.pool?.stats || {};
        console.log('Connection Pool Status:');
        console.log(`  Active connections: ${poolStats.size || 'N/A'}`);
        console.log(`  Available connections: ${poolStats.availableCount || 'N/A'}`);
        console.log('');

        console.log('✅ All tests passed! MongoDB connection is working correctly.\n');

    } catch (error) {
        console.error('\n❌ Connection failed!\n');
        console.error('Error details:');
        console.error(`  Message: ${error.message}`);
        console.error(`  Name: ${error.name}`);
        console.error(`  Code: ${error.code || 'N/A'}`);

        if (error.stack) {
            console.error('\nStack trace:');
            console.error(error.stack);
        }

        console.log('\n🔧 Troubleshooting:');

        if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
            console.log('  • DNS resolution failed - check MongoDB cluster hostname');
            console.log('  • Verify MONGODB_URI is correct');
        } else if (error.message.includes('authentication') || error.message.includes('auth')) {
            console.log('  • Authentication failed - check username/password in MONGODB_URI');
            console.log('  • Verify database user has correct permissions');
        } else if (error.message.includes('timeout')) {
            console.log('  • Connection timeout - possible causes:');
            console.log('    1. IP not whitelisted in MongoDB Atlas (Network Access)');
            console.log('    2. Firewall blocking outbound connections');
            console.log('    3. MongoDB cluster is paused or offline');
        } else if (error.message.includes('SSL') || error.message.includes('TLS')) {
            console.log('  • SSL/TLS error - check certificate configuration');
            console.log('  • Try updating MongoDB driver: npm install mongodb@latest');
        }

        console.log('\n📚 MongoDB Atlas checklist:');
        console.log('  1. Database Access: User exists with correct password');
        console.log('  2. Network Access: IP 0.0.0.0/0 is whitelisted (or your specific IP)');
        console.log('  3. Cluster is running (not paused)');
        console.log('  4. Connection string format: mongodb+srv://user:pass@cluster.mongodb.net/\n');

        process.exit(1);

    } finally {
        if (client) {
            await client.close();
            console.log('🔒 Connection closed.\n');
        }
    }
}

// Run test
testConnection().catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});
