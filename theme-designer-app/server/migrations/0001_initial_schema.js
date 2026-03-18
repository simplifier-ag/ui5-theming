/**
 * Initial schema migration — creates the themes table in its final state.
 * Uses createTableIfNotExists so it is safe for existing SQLite databases
 * that already have the table from the old better-sqlite3 bootstrap code.
 */
exports.up = async function (knex) {
    const exists = await knex.schema.hasTable('themes');
    if (!exists) {
        await knex.schema.createTable('themes', (table) => {
            table.increments('id').primary();
            table.string('themeId').notNullable();
            table.string('name').notNullable();
            table.string('baseTheme').notNullable();
            table.string('brandColor').notNullable();
            table.string('focusColor').notNullable();
            table.string('shellColor').defaultTo('#354a5f');
            table.string('ui5Version').defaultTo('1.96.40');
            table.text('customCss').defaultTo('');
            table.text('description').defaultTo('');
            table.string('userId').defaultTo('anonymous');
            table.string('createdAt').notNullable();
            table.string('updatedAt').notNullable();
        });
    }
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('themes');
};
