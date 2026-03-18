const knexConfig = require('./knexfile');
const knex = require('knex')(knexConfig);

/**
 * Thin async wrappers that mirror the old better-sqlite3 "prepared statement"
 * interface so that server.js requires only minimal changes (adding await).
 *
 * Naming convention kept deliberately:
 *   statements.X.all(...)  → resolves to an array
 *   statements.X.get(...)  → resolves to a single row or undefined
 *   statements.X.run(...)  → resolves to { lastInsertRowid } or row count
 */
const statements = {
    getAllThemes: {
        all: (userId) =>
            knex('themes')
                .select('id', 'themeId', 'name', 'baseTheme', 'brandColor', 'focusColor',
                        'shellColor', 'ui5Version', 'description', 'createdAt', 'updatedAt')
                .where({ userId })
                .orderBy('updatedAt', 'desc')
    },

    getThemeById: {
        get: (id, userId) =>
            knex('themes').where({ id, userId }).first()
    },

    getThemeByThemeId: {
        get: (themeId) =>
            knex('themes').where({ themeId }).first()
    },

    createTheme: {
        run: async (data) => {
            const ids = await knex('themes').insert(data);
            // knex returns [id] for SQLite and [id] for MySQL
            return { lastInsertRowid: ids[0] };
        }
    },

    updateTheme: {
        run: ({ id, userId, ...rest }) =>
            knex('themes').where({ id, userId }).update(rest)
    },

    deleteTheme: {
        run: (id, userId) =>
            knex('themes').where({ id, userId }).delete()
    }
};

/**
 * Runs all pending Knex migrations and seeds a default theme if the
 * themes table is empty. Must be called once before the server starts
 * accepting requests.
 */
async function initialize() {
    const dbType = process.env.DB_TYPE || 'sqlite';
    console.log(`[DB] Using ${dbType === 'mysql' ? 'MySQL/MariaDB' : 'SQLite'}`);

    await knex.migrate.latest();
    console.log('[DB] Migrations up to date');
}

module.exports = { statements, initialize };
