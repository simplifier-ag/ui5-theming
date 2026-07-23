const LessOpenUI5 = require('less-openui5');
const path = require('path');
const fs = require('fs').promises;
const fssync = require('fs');

/**
 * Discovers which base themes this builder can actually compile, purely from
 * what's installed in node_modules — no hardcoded list of theme ids.
 *
 * A themelib package (@openui5/themelib_*) can contain a folder per potential
 * variant under sap/ui/core/themes/, but that folder only represents a real,
 * compilable base theme if it has its own library.source.less directly inside.
 * Some variants (e.g. sap_horizon_dark on older UI5 versions) only ship a
 * fonts/ stub folder without library.source.less — those are NOT usable yet
 * and must be excluded.
 *
 * Returns a map of { [baseThemeId]: themelibPackageName }.
 */
function discoverThemeLibMap() {
	const openui5Dir = path.join(__dirname, 'node_modules', '@openui5');
	const map = {};

	let themeLibNames;
	try {
		themeLibNames = fssync.readdirSync(openui5Dir, { withFileTypes: true })
			.filter(entry => entry.isDirectory() && entry.name.startsWith('themelib_'))
			.map(entry => entry.name)
			.sort();
	} catch (error) {
		console.warn(`Could not read ${openui5Dir}: ${error.message}`);
		return map;
	}

	for (const themeLibName of themeLibNames) {
		const coreThemesDir = path.join(openui5Dir, themeLibName, 'src/sap/ui/core/themes');
		let variantNames;
		try {
			variantNames = fssync.readdirSync(coreThemesDir, { withFileTypes: true })
				.filter(entry => entry.isDirectory())
				.map(entry => entry.name);
		} catch {
			continue; // package doesn't have a sap.ui.core theme dir at all — skip
		}

		for (const variantName of variantNames) {
			const librarySourcePath = path.join(coreThemesDir, variantName, 'library.source.less');
			if (fssync.existsSync(librarySourcePath)) {
				map[variantName] = themeLibName;
			}
		}
	}

	return map;
}

const THEME_LIB_MAP = discoverThemeLibMap();
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
		// baseTheme -> { brandColor, focusColor, shellColor }. Safe to cache for the
		// lifetime of the process: node_modules (and thus the theme sources) never
		// change while this builder instance is running.
		this._defaultsCache = new Map();
	}

	// Returns the src root of the themelib npm package for a given base theme.
	getThemeLibPath(baseTheme) {
		const themeLib = THEME_LIB_MAP[baseTheme];
		if (!themeLib) throw new Error(`Unsupported base theme: ${baseTheme}. Supported: ${VALID_BASE_THEMES.join(', ')}`);
		return path.join(__dirname, 'node_modules/@openui5', themeLib, 'src');
	}

	/**
	 * Determines the real default brandColor/focusColor/shellColor for a base
	 * theme by asking the actual LESS compiler to resolve @sapBrandColor /
	 * @sapContent_FocusColor / @sapShellColor from that theme's own source —
	 * robust against variable aliases and LESS functions (contrast(), darken(),
	 * etc.), which a naive text search can't resolve correctly.
	 */
	async extractThemeDefaults(baseTheme) {
		if (this._defaultsCache.has(baseTheme)) {
			return this._defaultsCache.get(baseTheme);
		}

		const themeLibPath = this.getThemeLibPath(baseTheme);
		const corePath = LIBRARIES.find(l => l.name === 'sap.ui.core').path;

		const probeContent = `@import "${corePath}/${baseTheme}/library.source.less";
.theme-designer-color-probe {
	brand-color: @sapBrandColor;
	focus-color: @sapContent_FocusColor;
	shell-color: @sapShellColor;
}
`;

		const tempProbeFile = path.join(__dirname, 'temp', `probe_${baseTheme}_${process.pid}_${Date.now()}.less`);
		await fs.mkdir(path.dirname(tempProbeFile), { recursive: true });
		fssync.writeFileSync(tempProbeFile, probeContent);

		try {
			const result = await this.builder.build({
				lessInputPath: path.basename(tempProbeFile),
				rootPaths: [
					path.dirname(tempProbeFile),
					themeLibPath,
					...LIBRARIES.map(l => path.join(__dirname, 'node_modules/@openui5', l.name, 'src'))
				],
				library: { name: 'sap.ui.core' },
				rtl: false
			});

			const blockMatch = result.css.match(/\.theme-designer-color-probe\s*\{([^}]*)\}/);
			if (!blockMatch) {
				throw new Error(`Could not locate color probe output for base theme "${baseTheme}"`);
			}
			const block = blockMatch[1];

			const extract = (prop) => {
				const m = block.match(new RegExp(`${prop}\\s*:\\s*([^;]+);`));
				return m ? m[1].trim() : null;
			};

			const defaults = {
				brandColor: extract('brand-color'),
				focusColor: extract('focus-color'),
				shellColor: extract('shell-color')
			};

			for (const [key, value] of Object.entries(defaults)) {
				if (!value) throw new Error(`Could not determine default "${key}" for base theme "${baseTheme}"`);
			}

			this._defaultsCache.set(baseTheme, defaults);
			return defaults;
		} finally {
			try { fssync.unlinkSync(tempProbeFile); } catch { /* ignore */ }
		}
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
	// less-openui5 outputs url() paths relative to the temp root (first rootPath),
	// so they look like url('sap/ui/core/themes/{themeId}/images/...'). Fonts and images
	// only physically exist under sap.ui.core/themes/{themeId}/{fonts,images}/, so for
	// every library we rewrite those absolute paths to the correct relative path back
	// to sap.ui.core's theme dir. For sap.ui.core itself that collapses to 'images/' /
	// 'fonts/' (same dir); for sap.m it becomes '../../../ui/core/themes/{themeId}/...'.
	fixAssetPaths(css, baseTheme, themeId, libraryName = 'sap.ui.core') {
		const fontTheme = baseTheme.replace(/_(dark|hcb|hcw)$/, '');
		const coreThemePrefix = (theme) => `sap/ui/core/themes/${theme}/`;
		const fix = (str, prefix, replacement) =>
			str.replace(new RegExp(`url\\((['"])${prefix}`, 'g'), (_, q) => `url(${q}${replacement}`);

		const libraryThemePath = `${libraryName.replace(/\./g, '/')}/themes/${themeId}`;
		const coreThemePath    = `sap/ui/core/themes/${themeId}`;
		const relToCore = path.posix.relative(libraryThemePath, coreThemePath);
		const corePrefix = relToCore ? relToCore + '/' : '';

		let result = css;
		result = fix(result, `${coreThemePrefix(fontTheme)}fonts/`, `${corePrefix}fonts/`);
		result = fix(result, `${coreThemePrefix('base')}fonts/`,    `${corePrefix}fonts/`);
		result = fix(result, `${coreThemePrefix(themeId)}fonts/`,   `${corePrefix}fonts/`);
		result = fix(result, `${coreThemePrefix(themeId)}images/`,  `${corePrefix}images/`);
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
