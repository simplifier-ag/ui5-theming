/**
 * One-time data migration script: SQLite → MySQL/MariaDB
 *
 * Usage:
 *   SQLITE_PATH=./themes.db DB_TYPE=mysql DB_HOST=localhost DB_PORT=3306 \
 *   DB_NAME=themedesigner DB_USER=themedesigner DB_PASSWORD=secret \
 *   node migrate-data.js
 *
 * The script:
 *   1. Reads all rows from the existing SQLite database via better-sqlite3
 *   2. Runs Knex migrations on the target MySQL database (creates schema)
 *   3. Copies all rows using INSERT IGNORE (skips duplicates by id)
 */

'use strict';

const path = require('path');

// Load .env from project root
const dotenvPath = path.join(__dirname, '../../.env');
require('dotenv').config({ path: dotenvPath });

// Override DB_TYPE env for Knex config to point at MySQL target
// (SQLITE_PATH overrides the source path for better-sqlite3 below)
if (process.env.DB_TYPE !== 'mysql') {
    console.error('[migrate-data] DB_TYPE must be "mysql" to run this script.');
    console.error('  Example: DB_TYPE=mysql DB_HOST=localhost ... node migrate-data.js');
    process.exit(1);
}

const BetterSQLite = require('better-sqlite3');
const knex = require('knex')(require('./knexfile'));

async function main() {
    const sqlitePath = process.env.SQLITE_PATH || path.join(__dirname, 'themes.db');
    console.log(`[migrate-data] Reading SQLite source: ${sqlitePath}`);

    const sourceDb = new BetterSQLite(sqlitePath, { readonly: true });
    const rows = sourceDb.prepare('SELECT * FROM themes').all();
    sourceDb.close();

    console.log(`[migrate-data] Found ${rows.length} theme(s) in SQLite`);

    // Run migrations on MySQL target (creates schema + knex_migrations table)
    console.log('[migrate-data] Running Knex migrations on MySQL target...');
    await knex.migrate.latest();
    console.log('[migrate-data] Migrations complete');

    if (rows.length === 0) {
        console.log('[migrate-data] Nothing to copy.');
        await knex.destroy();
        return;
    }

    // Insert rows, skip duplicates (by id)
    let inserted = 0;
    let skipped = 0;
    for (const row of rows) {
        try {
            await knex('themes').insert(row).onConflict('id').ignore();
            inserted++;
        } catch (err) {
            console.warn(`[migrate-data] Skipped row id=${row.id}: ${err.message}`);
            skipped++;
        }
    }

    console.log(`[migrate-data] Done — ${inserted} inserted, ${skipped} skipped`);
    await knex.destroy();
}

main().catch((err) => {
    console.error('[migrate-data] Fatal error:', err);
    process.exit(1);
});
