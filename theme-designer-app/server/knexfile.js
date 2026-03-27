const path = require('path');

// Load .env from project root (same logic as server.js)
const dotenvPath = path.join(__dirname, '../../.env');
require('dotenv').config({ path: dotenvPath });

const dbDir = process.env.DATABASE_DIR || path.join(__dirname, 'data', 'db');
require('fs').mkdirSync(dbDir, { recursive: true });

module.exports = {
    client: process.env.DB_TYPE === 'mysql' ? 'mysql2' : 'better-sqlite3',
    connection: process.env.DB_TYPE === 'mysql'
        ? {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '3306', 10),
            database: process.env.DB_NAME || 'themedesigner',
            user: process.env.DB_USER || 'themedesigner',
            password: process.env.DB_PASSWORD || '',
            charset: 'utf8mb4',
            ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
        }
        : { filename: path.join(dbDir, 'themes.db') },
    useNullAsDefault: true,   // Required for SQLite (NULL instead of DEFAULT for missing values)
    pool: process.env.DB_TYPE === 'mysql'
        ? { min: 2, max: 10 }
        : { min: 1, max: 1 },   // better-sqlite3 requires single connection
    migrations: {
        directory: path.join(__dirname, 'migrations'),
        tableName: 'knex_migrations'
    }
};
