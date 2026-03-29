const LessOpenUI5 = require('less-openui5');
const path = require('path');
const fs = require('fs').promises;
const fssync = require('fs');

// ============================================================
// Shared constants — used by ThemeBuilder AND server.js
// ============================================================

const THEME_LIB_MAP = {
	'sap_horizon': 'themelib_sap_horizon',
	'sap_fiori_3': 'themelib_sap_fiori_3',
	'sap_fiori_3_dark': 'themelib_sap_fiori_3',
	'sap_fiori_3_hcb': 'themelib_sap_fiori_3',
	'sap_fiori_3_hcw': 'themelib_sap_fiori_3'
};

const VALID_BASE_THEMES = Object.keys(THEME_LIB_MAP);

// List of libraries to build (all standard OpenUI5 libraries)
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

// ============================================================
// ThemeBuilder
// ============================================================

class ThemeBuilder {
	constructor() {
		this.builder = new LessOpenUI5.Builder();
	}

	/**
	 * Returns the src root path of the themelib npm package for a given base theme.
	 */
	getThemeLibPath(baseTheme) {
		const themeLib = THEME_LIB_MAP[baseTheme];
		if (!themeLib) {
			throw new Error(`Unsupported base theme: ${baseTheme}. Supported: ${VALID_BASE_THEMES.join(', ')}`);
		}
		return path.join(__dirname, 'node_modules/@openui5', themeLib, 'src');
	}

	/**
	 * Returns the fonts directory for a given base theme and library.
	 * Theme variants (dark/hcb/hcw) inherit fonts from their root variant.
	 */
	getFontsDir(baseTheme, libraryName = 'sap.ui.core') {
		const themeLib = THEME_LIB_MAP[baseTheme];
		if (!themeLib) throw new Error(`Unsupported base theme: ${baseTheme}`);
		const fontTheme = baseTheme.replace(/_(dark|hcb|hcw)$/, '');
		const libraryPath = libraryName.replace(/\./g, '/');
		return path.join(__dirname, 'node_modules/@openui5', themeLib, 'src', libraryPath, 'themes', fontTheme, 'fonts');
	}

	/**
	 * Returns the base fonts directory for a library (e.g. SAP-icons lives under themes/base/fonts/).
	 */
	getBaseFontsDir(libraryName = 'sap.ui.core') {
		const libraryPath = libraryName.replace(/\./g, '/');
		return path.join(__dirname, 'node_modules/@openui5/sap.ui.core/src', libraryPath, 'themes/base/fonts');
	}

	/**
	 * Fixes font paths in compiled CSS — converts absolute paths to relative.
	 * less-openui5 generates: url('sap/ui/core/themes/sap_fiori_3/fonts/...')
	 *                    and: url('sap/ui/core/themes/base/fonts/...') (for SAP-icons)
	 * We need:                url('fonts/...') (relative to the CSS file location)
	 */
	fixFontPaths(css, libraryName, baseTheme) {
		const libraryPath = libraryName.replace(/\./g, '/');
		// Fix theme-specific font paths (72-* fonts)
		const pattern = new RegExp(`['"]${libraryPath}/themes/${baseTheme}/fonts/`, 'g');
		let result = css.replace(pattern, `'fonts/`);
		// Fix base theme font paths (SAP-icons lives under themes/base/fonts/)
		const basePattern = new RegExp(`['"]${libraryPath}/themes/base/fonts/`, 'g');
		return result.replace(basePattern, `'fonts/`);
	}

	/**
	 * Build a complete UI5 theme with custom colors — returns raw results per library.
	 */
	async buildTheme(options) {
		const { themeName, brandColor, focusColor, shellColor, customCss = '', baseTheme = 'sap_horizon' } = options;

		console.log(`Building theme: ${themeName}`);
		console.log(`Brand color: ${brandColor}, Focus color: ${focusColor}, Shell color: ${shellColor}`);

		const results = {};
		for (const library of LIBRARIES) {
			console.log(`Building library: ${library.name}`);
			try {
				const libResult = await this.buildLibrary(library, brandColor, focusColor, shellColor, customCss, baseTheme);
			if (libResult !== null) {
				results[library.name] = libResult;
			}
			} catch (error) {
				console.error(`Error building ${library.name}:`, error.message);
				throw new Error(`Failed to build ${library.name}: ${error.message}`);
			}
		}
		return results;
	}

	/**
	 * Build a single library — returns { css, cssRtl, variables }.
	 */
	async buildLibrary(library, brandColor, focusColor, shellColor, customCss, baseTheme, uniqueId = null) {
		const themeLibPath = this.getThemeLibPath(baseTheme);
		const libraryThemePath = path.join(themeLibPath, library.path, baseTheme);
		const librarySourcePath = path.join(libraryThemePath, 'library.source.less');

		try {
			await fs.access(librarySourcePath);
		} catch (error) {
			// Some libraries don't have all theme variants (e.g. sap.ui.ux3 has no sap_fiori_3_dark)
			return null;
		}

		const tempDirBase = path.join(__dirname, 'temp');
		const tempDir = uniqueId ? path.join(tempDirBase, uniqueId) : tempDirBase;
		fssync.mkdirSync(tempDir, { recursive: true });

		let customLessImport = '';
		if (customCss && customCss.trim() && customCss.trim() !== '/* Add your custom CSS here */') {
			fssync.writeFileSync(path.join(tempDir, 'custom.less'), customCss);
			customLessImport = `\n// Import custom CSS\n@import "custom.less";\n`;
		}

		const colorOverrides = this.generateColorOverrides(brandColor, focusColor, shellColor);
		const tempLessFile = path.join(tempDir, `${library.name.replace(/\./g, '_')}_custom.less`);
		const importPath = `${library.path}/${baseTheme}/library.source.less`;

		fssync.writeFileSync(tempLessFile, `
// Import base theme library
@import "${importPath}";

// Color overrides
${colorOverrides}${customLessImport}
`);

		const result = await this.builder.build({
			lessInputPath: path.basename(tempLessFile),
			rootPaths: [
				tempDir,
				themeLibPath,
				path.join(__dirname, 'node_modules/@openui5/sap.ui.core/src'),
				path.join(__dirname, 'node_modules/@openui5/sap.m/src'),
				path.join(__dirname, 'node_modules/@openui5/sap.ui.layout/src'),
				path.join(__dirname, 'node_modules/@openui5/sap.ui.unified/src'),
				path.join(__dirname, 'node_modules/@openui5/sap.ui.commons/src'),
				path.join(__dirname, 'node_modules/@openui5/sap.tnt/src'),
				path.join(__dirname, 'node_modules/@openui5/sap.ui.codeeditor/src'),
				path.join(__dirname, 'node_modules/@openui5/sap.f/src'),
				path.join(__dirname, 'node_modules/@openui5/sap.ui.rta/src'),
				path.join(__dirname, 'node_modules/@openui5/sap.uxap/src'),
				path.join(__dirname, 'node_modules/@openui5/sap.ui.table/src'),
				path.join(__dirname, 'node_modules/@openui5/sap.ui.ux3/src'),
				path.join(__dirname, 'node_modules/@openui5/sap.ui.fl/src'),
				path.join(__dirname, 'node_modules/@openui5/sap.ui.suite/src'),
				path.join(__dirname, 'node_modules/@openui5/sap.ui.integration/src'),
				path.join(__dirname, 'node_modules/@openui5/sap.ui.dt/src')
			],
			library: { name: library.name },
			rtl: true
		});

		if (!uniqueId) {
			try { fssync.unlinkSync(tempLessFile); } catch (e) { /* ignore */ }
		}

		return { css: result.css, cssRtl: result.cssRtl, variables: result.variables || {} };
	}

	/**
	 * Compile theme for preview — returns a Map of libraryName → CSS (with fixed font paths).
	 */
	async compilePreviewLibraries(options) {
		const { brandColor, focusColor, shellColor, customCss = '', baseTheme = 'sap_horizon' } = options;

		console.log(`Compiling preview libraries — base: ${baseTheme}, brand: ${brandColor}`);

		const uniqueId = `preview_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const libraryCss = new Map();

		for (const library of LIBRARIES) {
			try {
				const result = await this.buildLibrary(library, brandColor, focusColor, shellColor, customCss, baseTheme, uniqueId);
				if (result !== null) {
					libraryCss.set(library.name, this.fixFontPaths(result.css, library.name, baseTheme));
				}
			} catch (error) {
				console.error(`Error building ${library.name} for preview:`, error.message);
			}
		}

		try {
			fssync.rmSync(path.join(__dirname, 'temp', uniqueId), { recursive: true, force: true });
		} catch (e) { /* ignore */ }

		return libraryCss;
	}

	/**
	 * Generate LESS color overrides
	 */
	generateColorOverrides(brandColor, focusColor, shellColor) {
		return `
// Brand color overrides
@sapBrandColor: ${brandColor};
@sapContent_FocusColor: ${focusColor};
@sapShellColor: ${shellColor};
`;
	}

	/**
	 * Clear the builder cache
	 */
	clearCache() {
		this.builder.clearCache();
	}
}

// Export class and shared constants
ThemeBuilder.THEME_LIB_MAP = THEME_LIB_MAP;
ThemeBuilder.VALID_BASE_THEMES = VALID_BASE_THEMES;

module.exports = ThemeBuilder;
