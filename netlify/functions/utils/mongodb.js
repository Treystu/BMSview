const { MongoClient } = require("mongodb");

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME;

if (!MONGODB_URI) {
    throw new Error('Please define the MONGODB_URI environment variable');
}
if (!DB_NAME) {
    throw new Error('Please define the MONGODB_DB_NAME environment variable');
}

/**
 * @type {import('mongodb').MongoClient}
 */
let cachedClient = null;
/**
 * @type {import('mongodb').Db}
 */
let cachedDb = null;

async function connectToDatabase() {
    if (cachedClient && cachedDb) {
        return { client: cachedClient, db: cachedDb };
    }

    const client = new MongoClient(MONGODB_URI, {
        // Deprecated options removed
    });

    cachedClient = client;
    await client.connect();
    
    const db = client.db(DB_NAME);
    cachedDb = db;

    return { client, db };
}

/**
 * Helper to get a specific collection from the database.
 * @param {string} collectionName 
 * @returns {Promise<import('mongodb').Collection>}
 */
const getCollection = async (collectionName) => {
    const { db } = await connectToDatabase();
    return db.collection(collectionName);
};

module.exports = { connectToDatabase, getCollection };