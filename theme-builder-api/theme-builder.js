const LessOpenUI5 = require('less-openui5');
const path = require('path');
const fs = require('fs').promises;

// List of libraries to build (all standard OpenUI5 libraries)
const LIBRARIES = [
	{
		name: 'sap.ui.core',
		path: 'sap/ui/core/themes'
	},
	{
		name: 'sap.m',
		path: 'sap/m/themes'
	},
	{
		name: 'sap.ui.layout',
		path: 'sap/ui/layout/themes'
	},
	{
		name: 'sap.ui.unified',
		path: 'sap/ui/unified/themes'
	},
	{
		name: 'sap.ui.commons',
		path: 'sap/ui/commons/themes'
	},
	{
		name: 'sap.tnt',
		path: 'sap/tnt/themes'
	},
	{
		name: 'sap.ui.codeeditor',
		path: 'sap/ui/codeeditor/themes'
	},
	{
		name: 'sap.f',
		path: 'sap/f/themes'
	},
	{
		name: 'sap.ui.rta',
		path: 'sap/ui/rta/themes'
	},
	{
		name: 'sap.uxap',
		path: 'sap/uxap/themes'
	},
	{
		name: 'sap.ui.table',
		path: 'sap/ui/table/themes'
	},
	{
		name: 'sap.ui.ux3',
		path: 'sap/ui/ux3/themes'
	},
	{
		name: 'sap.ui.fl',
		path: 'sap/ui/fl/themes'
	},
	{
		name: 'sap.ui.suite',
		path: 'sap/ui/suite/themes'
	},
	{
		name: 'sap.ui.integration',
		path: 'sap/ui/integration/themes'
	},
	{
		name: 'sap.ui.dt',
		path: 'sap/ui/dt/themes'
	}
];

class ThemeBuilder {
	constructor() {
		this.builder = new LessOpenUI5.Builder();
	}

	/**
	 * Get the theme library path based on the base theme
	 */
	getThemeLibPath(baseTheme) {
		const themeLibMap = {
			'sap_horizon': 'themelib_sap_horizon',
			'sap_fiori_3': 'themelib_sap_fiori_3'
		};

		const themeLib = themeLibMap[baseTheme];
		if (!themeLib) {
			throw new Error(`Unsupported base theme: ${baseTheme}. Supported themes: ${Object.keys(themeLibMap).join(', ')}`);
		}

		return path.join(__dirname, 'node_modules/@openui5', themeLib, 'src');
	}

	/**
	 * Build a complete UI5 theme with custom colors
	 */
	async buildTheme(options) {
		const { themeName, brandColor, focusColor, shellColor, customCss = '', baseTheme = 'sap_horizon' } = options;

		console.log(`Building theme: ${themeName}`);
		console.log(`Brand color: ${brandColor}, Focus color: ${focusColor}, Shell color: ${shellColor}`);

		const results = {};

		// Build each library
		for (const library of LIBRARIES) {
			console.log(`Building library: ${library.name}`);
			try {
				const result = await this.buildLibrary(library, brandColor, focusColor, shellColor, customCss, baseTheme);
				results[library.name] = result;
			} catch (error) {
				console.error(`Error building ${library.name}:`, error.message);
				throw new Error(`Failed to build ${library.name}: ${error.message}`);
			}
		}

		return results;
	}

	/**
	 * Build a single library
	 */
	async buildLibrary(library, brandColor, focusColor, shellColor, customCss, baseTheme, uniqueId = null) {
		const themeLibPath = this.getThemeLibPath(baseTheme);
		const libraryThemePath = path.join(themeLibPath, library.path, baseTheme);
		const librarySourcePath = path.join(libraryThemePath, 'library.source.less');

		// Verify the file exists
		try {
			await fs.access(librarySourcePath);
		} catch (error) {
			throw new Error(`library.source.less not found at: ${librarySourcePath}`);
		}

		// Use unique temp directory to avoid race conditions
		const tempDirBase = path.join(__dirname, 'temp');
		const tempDir = uniqueId ? path.join(tempDirBase, uniqueId) : tempDirBase;
		const fsSyncops = require('fs');
		fsSyncops.mkdirSync(tempDir, { recursive: true });

		// Create separate custom.less file if there's custom CSS
		let customLessImport = '';
		if (customCss && customCss.trim() && customCss.trim() !== '/* Add your custom CSS here */') {
			const customLessFile = path.join(tempDir, 'custom.less');
			fsSyncops.writeFileSync(customLessFile, customCss);
			customLessImport = `\n// Import custom CSS\n@import "custom.less";\n`;
		}

		// Create color overrides LESS
		const colorOverrides = this.generateColorOverrides(brandColor, focusColor, shellColor);

		const tempLessFile = path.join(tempDir, `${library.name.replace(/\./g, '_')}_custom.less`);

		// Use path relative to themeLibPath for the import
		const importPath = `${library.path}/${baseTheme}/library.source.less`;

		// Create LESS content with import relative to rootPath
		const lessContent = `
// Import base theme library
@import "${importPath}";

// Color overrides
${colorOverrides}${customLessImport}
`;

		// Write temp file synchronously
		fsSyncops.writeFileSync(tempLessFile, lessContent);

		// Build with less-openui5
		// Use just the filename since the temp directory is in rootPaths
		const tempFileName = path.basename(tempLessFile);

		const buildOptions = {
			lessInputPath: tempFileName,
			rootPaths: [
				tempDir,  // Add temp directory first so the file can be found
				themeLibPath,  // Use the dynamic theme library path
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
			library: {
				name: library.name
			},
			rtl: true
		};

		const result = await this.builder.build(buildOptions);

		// Clean up temp file (only if not using unique directory)
		if (!uniqueId) {
			try {
				fsSyncops.unlinkSync(tempLessFile);
			} catch (e) {
				// Ignore cleanup errors
			}
		}

		return {
			css: result.css,
			cssRtl: result.cssRtl,
			variables: result.variables || {}
		};
	}

	/**
	 * Compile theme for preview (returns CSS only, no file output)
	 * Faster than buildTheme() as it skips file writing and RTL generation
	 */
	async compileThemeForPreview(options) {
		const { brandColor, focusColor, shellColor, customCss = '', baseTheme = 'sap_horizon' } = options;

		console.log(`Compiling preview theme with brand color: ${brandColor}, shell color: ${shellColor}`);

		// Generate unique ID for this preview build to avoid race conditions
		const uniqueId = `preview_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		const allCss = [];

		// Build all libraries for preview (same as export for 1:1 preview accuracy)
		for (const library of LIBRARIES) {
			try {
				const result = await this.buildLibrary(library, brandColor, focusColor, shellColor, customCss, baseTheme, uniqueId);
				allCss.push(`/* Library: ${library.name} */`);
				allCss.push(result.css);
			} catch (error) {
				console.error(`Error building ${library.name} for preview:`, error.message);
				// Continue with other libraries even if one fails
			}
		}

		// Clean up unique temp directory
		const tempDir = path.join(__dirname, 'temp', uniqueId);
		try {
			const fsSyncops = require('fs');
			fsSyncops.rmSync(tempDir, { recursive: true, force: true });
		} catch (e) {
			// Ignore cleanup errors
		}

		return allCss.join('\n\n');
	}

	/**
	 * Generate LESS color overrides (without custom CSS)
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

module.exports = ThemeBuilder;
