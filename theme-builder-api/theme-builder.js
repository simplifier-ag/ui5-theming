const LessOpenUI5 = require('less-openui5');
const path = require('path');
const fs = require('fs').promises;
const fssync = require('fs');

const THEME_LIB_MAP = {
	'sap_horizon':      'themelib_sap_horizon',
	'sap_fiori_3':      'themelib_sap_fiori_3',
	'sap_fiori_3_dark': 'themelib_sap_fiori_3',
	'sap_fiori_3_hcb':  'themelib_sap_fiori_3',
	'sap_fiori_3_hcw':  'themelib_sap_fiori_3'
};

const VALID_BASE_THEMES = Object.keys(THEME_LIB_MAP);

const LIBRARIES = [
	{ name: 'sap.ui.core',        path: 'sap/ui/core/themes' },
	{ name: 'sap.m',              path: 'sap/m/themes' },
	{ name: 'sap.ui.layout',      path: 'sap/ui/layout/themes' },
	{ name: 'sap.ui.unified',     path: 'sap/ui/unified/themes' },
	{ name: 'sap.ui.commons',     path: 'sap/ui/commons/themes' },
	{ name: 'sap.tnt',            path: 'sap/tnt/themes' },
	{ name: 'sap.ui.codeeditor',  path: 'sap/ui/codeeditor/themes' },
	{ name: 'sap.f',              path: 'sap/f/themes' },
	{ name: 'sap.ui.rta',         path: 'sap/ui/rta/themes' },
	{ name: 'sap.uxap',           path: 'sap/uxap/themes' },
	{ name: 'sap.ui.table',       path: 'sap/ui/table/themes' },
	{ name: 'sap.ui.ux3',         path: 'sap/ui/ux3/themes' },
	{ name: 'sap.ui.fl',          path: 'sap/ui/fl/themes' },
	{ name: 'sap.ui.suite',       path: 'sap/ui/suite/themes' },
	{ name: 'sap.ui.integration', path: 'sap/ui/integration/themes' },
	{ name: 'sap.ui.dt',          path: 'sap/ui/dt/themes' }
];

class ThemeBuilder {
	constructor() {
		this.builder = new LessOpenUI5.Builder();
	}

	// Returns the src root of the themelib npm package for a given base theme.
	getThemeLibPath(baseTheme) {
		const themeLib = THEME_LIB_MAP[baseTheme];
		if (!themeLib) throw new Error(`Unsupported base theme: ${baseTheme}. Supported: ${VALID_BASE_THEMES.join(', ')}`);
		return path.join(__dirname, 'node_modules/@openui5', themeLib, 'src');
	}

	// Returns the theme-specific fonts dir (72-* fonts).
	// Variants (dark/hcb/hcw) fall back to their root theme's fonts.
	getFontsDir(baseTheme) {
		const themeLib = THEME_LIB_MAP[baseTheme];
		if (!themeLib) throw new Error(`Unsupported base theme: ${baseTheme}`);
		const fontTheme = baseTheme.replace(/_(dark|hcb|hcw)$/, '');
		return path.join(__dirname, 'node_modules/@openui5', themeLib, 'src/sap/ui/core/themes', fontTheme, 'fonts');
	}

	// Returns the base fonts dir (SAP-icons lives under themes/base/fonts/).
	getBaseFontsDir() {
		return path.join(__dirname, 'node_modules/@openui5/sap.ui.core/src/sap/ui/core/themes/base/fonts');
	}

	// Fixes asset url() paths in compiled CSS.
	// less-openui5 outputs url() paths relative to the temp root (first rootPath).
	// For sap.ui.core the library.css lives in sap/ui/core/themes/{themeId}/ — the same
	// directory where fonts/ and images/ reside. But the compiler generates paths like
	// url('sap/ui/core/themes/{themeId}/fonts/...') which the browser would resolve
	// relative to the CSS file, doubling the path. We rewrite them to url('fonts/...').
	// The same applies to images/ for sap.ui.core.
	// For other libraries (sap.m etc.) the compiler correctly generates longer relative
	// paths (e.g. '../../../ui/core/themes/{themeId}/images/...') — no fixup needed there.
	fixAssetPaths(css, baseTheme, themeId) {
		const fontTheme = baseTheme.replace(/_(dark|hcb|hcw)$/, '');
		const coreThemePrefix = (theme) => `sap/ui/core/themes/${theme}/`;
		const fix = (str, prefix, replacement) =>
			str.replace(new RegExp(`url\\((['"])${prefix}`, 'g'), (_, q) => `url(${q}${replacement}`);
		let result = css;
		result = fix(result, `${coreThemePrefix(fontTheme)}fonts/`, 'fonts/');
		result = fix(result, `${coreThemePrefix('base')}fonts/`, 'fonts/');
		result = fix(result, `${coreThemePrefix(themeId)}fonts/`, 'fonts/');
		result = fix(result, `${coreThemePrefix(themeId)}images/`, 'images/');
		return result;
	}

	/**
	 * Builds a complete UI5 theme — returns compiled results keyed by library name.
	 *
	 * LESS files are written into the correct sub-folder structure inside tempDir so that
	 * less-openui5 (with relativeUrls: true) automatically computes correct relative url()
	 * paths for fonts and images — no post-compilation fixup needed.
	 *
	 * Structure inside tempDir:
	 *   sap/ui/core/themes/{themeName}/base.less        — color overrides + image vars + @import "custom.less"
	 *   sap/ui/core/themes/{themeName}/core_extra.less   — @font-face declarations + background image selector
	 *   sap/ui/core/themes/{themeName}/custom.less       — user's raw LESS/CSS
	 *   sap/ui/core/themes/{themeName}/fonts/            — symlinks/copies of font files (must exist before compile)
	 *   sap/ui/core/themes/{themeName}/images/           — symlinks/copies of image files (must exist before compile)
	 *   {lib}_custom.less per library                    — entry point that imports library.source.less + base.less
	 *
	 * Caller must ensure fonts/ and images/ directories are populated in the coreThemeDir
	 * BEFORE calling this method (see buildThemeToDir in server.js).
	 */
	async buildTheme({ themeName, baseLessContent = '', coreExtraContent = '', customCss = '', baseTheme = 'sap_horizon', uniqueId = null }) {
		console.log(`Building theme: ${themeName}`);

		const tempDir = uniqueId ? path.join(__dirname, 'temp', uniqueId) : path.join(__dirname, 'temp');
		const coreThemeDir = path.join(tempDir, 'sap', 'ui', 'core', 'themes', themeName);
		fssync.mkdirSync(coreThemeDir, { recursive: true });

		const hasBase      = !!(baseLessContent.trim());
		const hasCoreExtra = !!(coreExtraContent.trim());
		const hasCustom    = !!(customCss.trim());
		if (hasBase)      fssync.writeFileSync(path.join(coreThemeDir, 'base.less'),       baseLessContent);
		if (hasCoreExtra) fssync.writeFileSync(path.join(coreThemeDir, 'core_extra.less'), coreExtraContent);
 		if (hasCustom)    fssync.writeFileSync(path.join(coreThemeDir, 'custom.less'),     `/*<SAP_FREETEXT_LESS>*/${customCss}/*</SAP_FREETEXT_LESS>*/`);

		const results = {};
		for (const library of LIBRARIES) {
			console.log(`Building library: ${library.name}`);
			const isCore = library.name === 'sap.ui.core';
			try {
				const libResult = await this.buildLibrary(library, baseTheme, themeName, uniqueId, isCore, hasBase, hasCoreExtra);
				if (libResult !== null) results[library.name] = libResult;
			} catch (error) {
				console.error(`Error building ${library.name}:`, error.message);
				throw new Error(`Failed to build ${library.name}: ${error.message}`);
			}
		}
		return results;
	}

	/**
	 * Returns the path to the core theme dir inside the temp directory.
	 * Needed by server.js to copy fonts/images there before compilation.
	 */
	getCoreThemeDir(uniqueId, themeName) {
		const tempDir = uniqueId ? path.join(__dirname, 'temp', uniqueId) : path.join(__dirname, 'temp');
		return path.join(tempDir, 'sap', 'ui', 'core', 'themes', themeName);
	}

	// Builds a single library — returns { css, cssRtl } or null if the theme variant doesn't exist.
	async buildLibrary(library, baseTheme, themeName, uniqueId = null, isCore = false, hasBase = false, hasCoreExtra = false) {
		const themeLibPath = this.getThemeLibPath(baseTheme);
		const librarySourcePath = path.join(themeLibPath, library.path, baseTheme, 'library.source.less');

		try {
			await fs.access(librarySourcePath);
		} catch {
			// Some libraries don't have all theme variants (e.g. sap.ui.ux3 has no sap_fiori_3_dark)
			return null;
		}

		const tempDir = uniqueId ? path.join(__dirname, 'temp', uniqueId) : path.join(__dirname, 'temp');
		const coreThemePath = `sap/ui/core/themes/${themeName}`;

		let imports = '';
		if (hasBase)                imports += `\n@import "${coreThemePath}/base.less";\n`;
		if (isCore && hasCoreExtra) imports += `\n@import "${coreThemePath}/core_extra.less";\n`;

		const tempLessFile = path.join(tempDir, `${library.name.replace(/\./g, '_')}_custom.less`);
		fssync.writeFileSync(tempLessFile, `@import "${library.path}/${baseTheme}/library.source.less";\n${imports}`);

		const result = await this.builder.build({
			lessInputPath: path.basename(tempLessFile),
			rootPaths: [
				tempDir,
				themeLibPath,
				...LIBRARIES.map(l => path.join(__dirname, 'node_modules/@openui5', l.name, 'src'))
			],
			library: { name: library.name },
			rtl: true
		});

		if (!uniqueId) {
			try { fssync.unlinkSync(tempLessFile); } catch { /* ignore */ }
		}

		return { css: result.css, cssRtl: result.cssRtl };
	}

	clearCache() {
		this.builder.clearCache();
	}
}

ThemeBuilder.THEME_LIB_MAP = THEME_LIB_MAP;
ThemeBuilder.VALID_BASE_THEMES = VALID_BASE_THEMES;

module.exports = ThemeBuilder;
