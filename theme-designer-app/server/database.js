const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Initialize database
// Use DATABASE_DIR from .env if provided, otherwise use current directory
const dbDir = process.env.DATABASE_DIR || __dirname;

// Ensure database directory exists
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`Created database directory: ${dbDir}`);
}

const dbPath = path.join(dbDir, 'themes.db');
console.log(`Using database at: ${dbPath}`);

const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Create themes table
db.exec(`
    CREATE TABLE IF NOT EXISTS themes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        themeId TEXT NOT NULL,
        name TEXT NOT NULL,
        baseTheme TEXT NOT NULL,
        brandColor TEXT NOT NULL,
        focusColor TEXT NOT NULL,
        customCss TEXT DEFAULT '',
        description TEXT DEFAULT '',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
    )
`);

// Migration 1: Rename hoverColor to focusColor if needed
const columns = db.prepare("PRAGMA table_info(themes)").all();
const hasHoverColor = columns.some(col => col.name === 'hoverColor');
const hasFocusColor = columns.some(col => col.name === 'focusColor');

if (hasHoverColor && !hasFocusColor) {
    console.log('Migrating database: renaming hoverColor to focusColor...');
    db.exec(`
        ALTER TABLE themes RENAME COLUMN hoverColor TO focusColor
    `);
    console.log('Migration completed successfully');
}

// Migration 2: Rename name to themeId and label to name
const hasThemeId = columns.some(col => col.name === 'themeId');
const hasOldName = columns.some(col => col.name === 'name');
const hasLabel = columns.some(col => col.name === 'label');

if (!hasThemeId && hasOldName && hasLabel) {
    console.log('Migrating database: renaming name→themeId and label→name...');

    // SQLite doesn't support renaming multiple columns directly
    // We need to create a new table and copy data
    db.exec(`
        -- Create new table with correct schema
        CREATE TABLE themes_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            themeId TEXT NOT NULL,
            name TEXT NOT NULL,
            baseTheme TEXT NOT NULL,
            brandColor TEXT NOT NULL,
            focusColor TEXT NOT NULL,
            customCss TEXT DEFAULT '',
            description TEXT DEFAULT '',
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        );

        -- Copy data with column renaming
        INSERT INTO themes_new (id, themeId, name, baseTheme, brandColor, focusColor, customCss, description, createdAt, updatedAt)
        SELECT id, name, label, baseTheme, brandColor, focusColor, customCss, description, createdAt, updatedAt
        FROM themes;

        -- Drop old table
        DROP TABLE themes;

        -- Rename new table
        ALTER TABLE themes_new RENAME TO themes;
    `);

    console.log('Migration completed: columns renamed (name→themeId, label→name)');
} else if (!hasThemeId && hasOldName && !hasLabel) {
    // Old schema without label column - add name column and migrate
    console.log('Migrating database: adding name column and renaming old name to themeId...');

    db.exec(`
        -- Add name column first
        ALTER TABLE themes ADD COLUMN name TEXT;

        -- Populate name with old name value
        UPDATE themes SET name = (SELECT name FROM themes t WHERE t.id = themes.id);

        -- Now create new table to rename old name to themeId
        CREATE TABLE themes_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            themeId TEXT NOT NULL,
            name TEXT NOT NULL,
            baseTheme TEXT NOT NULL,
            brandColor TEXT NOT NULL,
            focusColor TEXT NOT NULL,
            customCss TEXT DEFAULT '',
            description TEXT DEFAULT '',
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        );

        -- Copy data
        INSERT INTO themes_new (id, themeId, name, baseTheme, brandColor, focusColor, customCss, description, createdAt, updatedAt)
        SELECT id, name, name, baseTheme, brandColor, focusColor, customCss, description, createdAt, updatedAt
        FROM themes;

        -- Drop old table
        DROP TABLE themes;

        -- Rename new table
        ALTER TABLE themes_new RENAME TO themes;
    `);

    console.log('Migration completed: name→themeId and name column added');
}

// Migration 3: Add userId column for user isolation
const hasUserId = columns.some(col => col.name === 'userId');
if (!hasUserId) {
    console.log('Migrating database: adding userId column...');
    db.exec(`
        ALTER TABLE themes ADD COLUMN userId TEXT DEFAULT 'anonymous'
    `);
    console.log('Migration completed: userId column added');
}

// Migration 4: Add shellColor column
const hasShellColor = columns.some(col => col.name === 'shellColor');
if (!hasShellColor) {
    console.log('Migrating database: adding shellColor column...');
    db.exec(`
        ALTER TABLE themes ADD COLUMN shellColor TEXT DEFAULT '#354a5f'
    `);
    console.log('Migration completed: shellColor column added');
}

// Migration 5: Add ui5Version column for multi-version support
const hasUi5Version = columns.some(col => col.name === 'ui5Version');
if (!hasUi5Version) {
    console.log('Migrating database: adding ui5Version column...');
    db.exec(`
        ALTER TABLE themes ADD COLUMN ui5Version TEXT DEFAULT '1.96.40'
    `);
    console.log('Migration completed: ui5Version column added (default: 1.96.40)');
}

// Prepared statements for better performance
const statements = {
    // Get all themes for a user
    getAllThemes: db.prepare(`
        SELECT id, themeId, name, baseTheme, brandColor, focusColor, shellColor, ui5Version, description, createdAt, updatedAt
        FROM themes
        WHERE userId = ?
        ORDER BY updatedAt DESC
    `),

    // Get theme by ID and user
    getThemeById: db.prepare(`
        SELECT * FROM themes WHERE id = ? AND userId = ?
    `),

    // Get theme by themeId (no user filter for backwards compatibility)
    getThemeByThemeId: db.prepare(`
        SELECT * FROM themes WHERE themeId = ?
    `),

    // Create new theme
    createTheme: db.prepare(`
        INSERT INTO themes (themeId, name, baseTheme, brandColor, focusColor, shellColor, ui5Version, customCss, description, userId, createdAt, updatedAt)
        VALUES (@themeId, @name, @baseTheme, @brandColor, @focusColor, @shellColor, @ui5Version, @customCss, @description, @userId, @createdAt, @updatedAt)
    `),

    // Update theme
    updateTheme: db.prepare(`
        UPDATE themes
        SET themeId = @themeId,
            name = @name,
            baseTheme = @baseTheme,
            brandColor = @brandColor,
            focusColor = @focusColor,
            shellColor = @shellColor,
            ui5Version = @ui5Version,
            customCss = @customCss,
            description = @description,
            updatedAt = @updatedAt
        WHERE id = @id AND userId = @userId
    `),

    // Delete theme
    deleteTheme: db.prepare(`
        DELETE FROM themes WHERE id = ? AND userId = ?
    `)
};

// Create default theme if database is empty
const themeCount = db.prepare('SELECT COUNT(*) as count FROM themes').get();
if (themeCount.count === 0) {
    const now = new Date().toISOString();
    statements.createTheme.run({
        themeId: 'default_theme',
        name: 'Default Theme',
        baseTheme: 'sap_horizon',
        brandColor: '#0070f2',  // SAP Horizon default
        focusColor: '#0032a5',  // SAP Horizon default
        shellColor: '#ffffff',  // SAP Horizon default (white)
        ui5Version: '1.96.40',  // Default UI5 version
        customCss: '',
        description: 'Default theme with SAP Horizon base',
        userId: 'anonymous',
        createdAt: now,
        updatedAt: now
    });
    console.log('Created default theme (UI5 1.96.40)');
}

module.exports = {
    db,
    statements
};