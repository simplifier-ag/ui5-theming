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

	// Fixes image url() in compiled CSS: replaces url('images/...') with the correct relative path
	// from the library's theme dir to sap/ui/core/themes/{themeId}/images/.
	fixImagePaths(css, imagesRelPath) {
		return css
			.replace(/url\('images\//g, `url('${imagesRelPath}/`)
			.replace(/url\("images\//g, `url("${imagesRelPath}/`);
	}

	// Fixes font url() in compiled CSS.
	// less-openui5 generates absolute paths like url('sap/ui/core/themes/sap_fiori_3/fonts/...')
	// and url('sap/ui/core/themes/base/fonts/...'). Both get rewritten to url('fonts/...').
	fixFontPaths(css, libraryName, baseTheme) {
		const lib = libraryName.replace(/\./g, '/');
		let result = css.replace(new RegExp(`['"]${lib}/themes/${baseTheme}/fonts/`, 'g'), `'fonts/`);
		return result.replace(new RegExp(`['"]${lib}/themes/base/fonts/`, 'g'), `'fonts/`);
	}

	/**
	 * Builds a complete UI5 theme — returns compiled results keyed by library name.
	 *
	 * base.less:       imported by every library — color overrides + image vars + @import "custom.less"
	 * core_extra.less: imported only by sap.ui.core — @font-face declarations + background image selector
	 * custom.less:     user's raw LESS/CSS — imported by base.less
	 *
	 * All three files are written to tempDir root. less-openui5 rewrites url() paths relative to the
	 * LESS file's position in rootPaths — keeping files at root ensures url('images/...') and
	 * url('fonts/...') pass through unchanged for fixImagePaths/fixFontPaths to handle.
	 */
	async buildTheme({ themeName, baseLessContent = '', coreExtraContent = '', customCss = '', baseTheme = 'sap_horizon', uniqueId = null }) {
		console.log(`Building theme: ${themeName}`);

		const tempDir = uniqueId ? path.join(__dirname, 'temp', uniqueId) : path.join(__dirname, 'temp');
		fssync.mkdirSync(tempDir, { recursive: true });

		const hasBase      = !!(baseLessContent.trim());
		const hasCoreExtra = !!(coreExtraContent.trim());
		const hasCustom    = !!(customCss.trim());
		if (hasBase)      fssync.writeFileSync(path.join(tempDir, 'base.less'),       baseLessContent);
		if (hasCoreExtra) fssync.writeFileSync(path.join(tempDir, 'core_extra.less'), coreExtraContent);
		if (hasCustom)    fssync.writeFileSync(path.join(tempDir, 'custom.less'),     customCss);

		const results = {};
		for (const library of LIBRARIES) {
			console.log(`Building library: ${library.name}`);
			const isCore = library.name === 'sap.ui.core';
			try {
				const libResult = await this.buildLibrary(library, baseTheme, uniqueId, isCore, hasBase, hasCoreExtra);
				if (libResult !== null) results[library.name] = libResult;
			} catch (error) {
				console.error(`Error building ${library.name}:`, error.message);
				throw new Error(`Failed to build ${library.name}: ${error.message}`);
			}
		}
		return results;
	}

	// Builds a single library — returns { css, cssRtl } or null if the theme variant doesn't exist.
	async buildLibrary(library, baseTheme, uniqueId = null, isCore = false, hasBase = false, hasCoreExtra = false) {
		const themeLibPath = this.getThemeLibPath(baseTheme);
		const librarySourcePath = path.join(themeLibPath, library.path, baseTheme, 'library.source.less');

		try {
			await fs.access(librarySourcePath);
		} catch {
			// Some libraries don't have all theme variants (e.g. sap.ui.ux3 has no sap_fiori_3_dark)
			return null;
		}

		const tempDir = uniqueId ? path.join(__dirname, 'temp', uniqueId) : path.join(__dirname, 'temp');

		let imports = '';
		if (hasBase)                imports += `\n@import "base.less";\n`;
		if (isCore && hasCoreExtra) imports += `\n@import "core_extra.less";\n`;

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
