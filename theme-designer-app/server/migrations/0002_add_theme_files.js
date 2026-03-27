/**
 * Migration: adds the theme_files table.
 *
 * Stores files (images, fonts, …) that belong to a theme.
 * The `type` column separates file categories so each can have
 * its own export/preview logic without needing separate tables.
 *
 * Current types:
 *   'image' – user-uploaded images, referenced as url('images/<filename>') in Custom CSS
 *
 * Future types (not yet implemented):
 *   'font'  – custom font files, require different export handling
 */
exports.up = async function (knex) {
    await knex.schema.createTable('theme_files', (table) => {
        table.increments('id').primary();
        table.integer('themeId').notNullable();   // FK to themes.id (enforced in app code)
        table.string('type').notNullable();        // 'image' | 'font' | …
        table.string('filename').notNullable();    // sanitised leaf name, e.g. "logo.png"
        table.string('mimeType').notNullable();
        table.integer('size').notNullable();       // file size in bytes
        table.string('createdAt').notNullable();
    });

    await knex.schema.alterTable('themes', (table) => {
        table.string('backgroundImage').nullable().defaultTo('');
    });
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('theme_files');

    await knex.schema.alterTable('themes', (table) => {
        table.dropColumn('backgroundImage');
    });
};
