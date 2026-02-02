/**
 * Theme Builder API - Stateless Theme Compilation Service
 *
 * This is a stateless microservice that compiles OpenUI5/SAPUI5 themes using LESS.
 * It has NO authentication, NO database, NO sessions - only LESS compilation.
 *
 * Designed to be version-specific: each instance compiles themes for a specific UI5 version
 * (e.g., 1.96.40, 1.120.0) based on the installed @openui5 packages.
 *
 * Endpoints:
 * - POST /api/preview-theme - Compile CSS for live preview
 * - POST /api/compile-theme - Compile full theme ZIP export
 * - GET /api/theme-defaults/:baseTheme - Get default colors for a base theme
 * - GET /health - Health check endpoint
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs').promises;
const archiver = require('archiver');
const ThemeBuilder = require('./theme-builder');

const app = express();
const port = process.env.PORT || 3000;
const UI5_VERSION = process.env.UI5_VERSION || '1.96.40';

// Initialize theme builder
const themeBuilder = new ThemeBuilder();

// Middleware
app.use(cors({
	origin: '*',  // Allow all origins (API is internal to Docker network)
	credentials: false  // No credentials needed (stateless)
}));
app.use(bodyParser.json());

// Logging middleware
app.use((req, res, next) => {
	console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
	next();
});

// ========================================
// Helper Functions
// ========================================

/**
 * Get default theme colors for a given base theme
 */
function getThemeDefaults(baseTheme) {
	const defaults = {
		sap_fiori_3: {
			brandColor: '#0a6ed1',
			focusColor: '#000000',
			shellColor: '#354a5f'
		},
		sap_horizon: {
			brandColor: '#0070f2',
			focusColor: '#0032a5',
			shellColor: '#ffffff'
		}
	};

	return defaults[baseTheme] || defaults.sap_horizon;
}

// ========================================
// API Endpoints
// ========================================

/**
 * GET /health - Health check endpoint
 */
app.get('/health', (req, res) => {
	res.json({
		status: 'ok',
		message: 'Theme Builder API is running',
		ui5Version: UI5_VERSION,
		timestamp: new Date().toISOString()
	});
});

/**
 * GET /api/theme-defaults/:baseTheme - Get default colors for a base theme
 */
app.get('/api/theme-defaults/:baseTheme', (req, res) => {
	const baseTheme = req.params.baseTheme;
	const defaults = getThemeDefaults(baseTheme);
	res.json(defaults);
});

/**
 * POST /api/preview-theme - Compile CSS for live preview
 *
 * Request Body:
 * - baseTheme: string (e.g., "sap_horizon", "sap_fiori_3")
 * - brandColor: string (e.g., "#ff6600")
 * - focusColor: string (optional)
 * - shellColor: string (optional)
 * - customCss: string (optional, custom LESS/CSS code)
 *
 * Response: text/css (compiled CSS for all libraries)
 */
app.post('/api/preview-theme', async (req, res) => {
	try {
		const { baseTheme, brandColor, focusColor, shellColor, customCss } = req.body;

		console.log(`[Preview] UI5 ${UI5_VERSION} - Brand: ${brandColor}, Base: ${baseTheme}`);

		// Validate input
		if (!brandColor) {
			return res.status(400).json({ error: 'Brand color is required' });
		}

		// Validate baseTheme
		const validBaseThemes = ['sap_horizon', 'sap_fiori_3'];
		if (baseTheme && !validBaseThemes.includes(baseTheme)) {
			return res.status(400).json({
				error: 'Invalid base theme',
				validThemes: validBaseThemes
			});
		}

		// Get defaults for the base theme
		const defaults = getThemeDefaults(baseTheme || 'sap_horizon');

		// Compile theme for preview
		const css = await themeBuilder.compileThemeForPreview({
			brandColor: brandColor || defaults.brandColor,
			focusColor: focusColor || defaults.focusColor,
			shellColor: shellColor || defaults.shellColor,
			customCss: customCss || '',
			baseTheme: baseTheme || 'sap_horizon'
		});

		// Return CSS as text
		res.setHeader('Content-Type', 'text/css');
		res.send(css);

	} catch (error) {
		console.error('[Preview] Compilation error:', error);
		res.status(500).json({
			error: 'Failed to compile preview theme',
			details: error.message,
			ui5Version: UI5_VERSION
		});
	}
});

/**
 * POST /api/compile-theme - Compile full theme ZIP export
 *
 * Request Body:
 * - themeId: string (technical theme name, used as directory name)
 * - themeName: string (display name)
 * - baseTheme: string (e.g., "sap_horizon", "sap_fiori_3")
 * - brandColor: string (e.g., "#ff6600")
 * - focusColor: string (optional)
 * - shellColor: string (optional)
 * - customCss: string (optional, custom LESS/CSS code)
 * - description: string (optional)
 *
 * Response: application/zip (complete theme ZIP with all 16 libraries)
 */
app.post('/api/compile-theme', async (req, res) => {
	try {
		const { themeId, themeName, baseTheme, brandColor, focusColor, shellColor, customCss, description } = req.body;

		console.log(`[Export] UI5 ${UI5_VERSION} - Theme: ${themeId} (${themeName})`);
		console.log(`[Export] Base: ${baseTheme}, Brand: ${brandColor}`);

		// Validate input
		if (!themeId || !themeName || !baseTheme || !brandColor) {
			return res.status(400).json({ error: 'Missing required parameters: themeId, themeName, baseTheme, brandColor' });
		}

		// Validate baseTheme
		const supportedThemes = ['sap_horizon', 'sap_fiori_3'];
		if (!baseTheme || !supportedThemes.includes(baseTheme)) {
			return res.status(400).json({
				error: 'Invalid base theme',
				message: `Base theme must be one of: ${supportedThemes.join(', ')}`
			});
		}

		// Build complete theme using ThemeBuilder
		console.log('[Export] Building theme with ThemeBuilder...');
		const themeResults = await themeBuilder.buildTheme({
			themeName: themeId,  // Use themeId as technical directory name
			brandColor,
			focusColor,
			shellColor,
			customCss,
			baseTheme
		});

		// Create temporary directory for theme generation
		const tempDir = path.join(__dirname, 'temp', themeId);
		await fs.mkdir(tempDir, { recursive: true });

		// Create theme root directory (without UI5 subfolder, we'll add it during archiving)
		const themeRootDir = tempDir;  // Use tempDir directly
		await fs.mkdir(themeRootDir, { recursive: true });

		// Create library directories and write CSS files
		for (const [libraryName, result] of Object.entries(themeResults)) {
			console.log(`[Export] Writing ${libraryName} CSS files...`);

			// Create library path (e.g., UI5/sap/m/themes/my_theme/)
			const libraryPath = libraryName.replace(/\./g, '/');
			const libraryThemeDir = path.join(themeRootDir, libraryPath, 'themes', themeId);
			await fs.mkdir(libraryThemeDir, { recursive: true });

			// Fix font paths in CSS - convert absolute paths to relative paths
			// less-openui5 generates: url('sap/ui/core/themes/sap_horizon/fonts/...')
			// We need: url('fonts/...') (relative to the CSS file location)
			// IMPORTANT: Use baseTheme name, not themeName, because less-openui5 generates paths with base theme
			const libraryPathInCss = libraryName.replace(/\./g, '/');
			const fontPathPattern = new RegExp(`['"]${libraryPathInCss}/themes/${baseTheme}/fonts/`, 'g');

			const fixedCss = result.css.replace(fontPathPattern, `'fonts/`);
			const fixedCssRtl = result.cssRtl.replace(fontPathPattern, `'fonts/`);

			// Write CSS files with fixed font paths
			await fs.writeFile(path.join(libraryThemeDir, 'library.css'), fixedCss);
			await fs.writeFile(path.join(libraryThemeDir, 'library-RTL.css'), fixedCssRtl);

			// Create .theming file (metadata for UI5)
			const themingMetadata = JSON.stringify({
				sEntity: "Theme",
				sId: themeId,
				sVendor: "Custom",
				oExtends: baseTheme,
				sDescription: description || `Custom theme ${themeId}`,
				sLabel: themeName,
				sVersion: UI5_VERSION  // Use UI5_VERSION from environment
			}, null, 2);
			await fs.writeFile(path.join(libraryThemeDir, '.theming'), themingMetadata);

			// Create library-parameters.json (theme parameters)
			const parameters = {
				sapBrandColor: brandColor,
				sapContent_FocusColor: focusColor,
				sapShellColor: shellColor
			};
			await fs.writeFile(
				path.join(libraryThemeDir, 'library-parameters.json'),
				JSON.stringify(parameters, null, 2)
			);

			// Copy custom.less file from theme-builder temp directory for sap.ui.core
			if (libraryName === 'sap.ui.core' && customCss && customCss.trim() !== '' && customCss.trim() !== '/* Add your custom CSS here */') {
				const sourceCustomLess = path.join(__dirname, 'temp', 'custom.less');
				try {
					// Check if custom.less was created by theme-builder
					await fs.access(sourceCustomLess);

					// Create custom.less with only the user's custom CSS
					// Note: We don't include Base imports because we don't export the Base directory
					const customLessContent = `/*<SAP_FREETEXT_LESS>*/${customCss}/*</SAP_FREETEXT_LESS>*/`;

					await fs.writeFile(
						path.join(libraryThemeDir, 'custom.less'),
						customLessContent
					);
					console.log('[Export]   Created custom.less with custom CSS');
				} catch (error) {
					console.warn('[Export]   custom.less not found in theme-builder temp, skipping');
				}
			}

			// Copy font files for sap.ui.core library
			if (libraryName === 'sap.ui.core') {
				console.log('[Export] Copying font files from base theme...');
				const themeLibMap = {
					'sap_horizon': 'themelib_sap_horizon',
					'sap_fiori_3': 'themelib_sap_fiori_3'
				};
				const themeLib = themeLibMap[baseTheme];
				const baseFontsDir = path.join(__dirname, 'node_modules/@openui5', themeLib, 'src/sap/ui/core/themes', baseTheme, 'fonts');
				const targetFontsDir = path.join(libraryThemeDir, 'fonts');

				try {
					// Check if fonts directory exists in base theme
					await fs.access(baseFontsDir);

					// Create target fonts directory
					await fs.mkdir(targetFontsDir, { recursive: true });

					// Copy all font files
					const fontFiles = await fs.readdir(baseFontsDir);
					for (const fontFile of fontFiles) {
						const sourcePath = path.join(baseFontsDir, fontFile);
						const targetPath = path.join(targetFontsDir, fontFile);
						await fs.copyFile(sourcePath, targetPath);
						console.log(`[Export]   Copied font: ${fontFile}`);
					}
				} catch (error) {
					console.warn(`[Export] Warning: Could not copy fonts from ${baseFontsDir}:`, error.message);
				}
			}
		}

		// Create exportThemesInfo.json
		const libraryList = Object.keys(themeResults).reduce((acc, libName) => {
			acc[libName] = {
				name: libName,
				version: UI5_VERSION
			};
			return acc;
		}, {});

		const exportThemesInfo = {
			zipInfo: {
				creatorName: "OpenUI5 Theme Designer",
				creatorVersion: "1.0.0",
				created: new Date().toISOString(),
				lessVersion: "3.13.1",
				compression: "none",
				exportMode: "ALL"
			},
			contentInfo: {
				frameworks: {
					openui5: {
						name: "OpenUI5",
						version: UI5_VERSION
					}
				},
				libraries: libraryList,
				themes: {
					[themeId]: {
						id: themeId,
						extends: baseTheme,
						label: themeName,
						vendor: "Custom",
						textDirections: ["LTR", "RTL"]
					}
				}
			}
		};

		await fs.writeFile(
			path.join(tempDir, 'exportThemesInfo.json'),
			JSON.stringify(exportThemesInfo, null, 2)
		);

		// Create README.md
		const readme = `# ${themeName}

Custom OpenUI5 theme generated by OpenUI5 Theme Designer.

## Theme Information

- **Theme ID**: ${themeId}
- **Display Name**: ${themeName}
- **Base Theme**: ${baseTheme}
- **OpenUI5 Version**: ${UI5_VERSION}
- **Created**: ${new Date().toISOString()}

## Installation

1. Extract this ZIP file
2. Copy the \`UI5\` folder to your application's resources directory
3. Reference the theme in your app:
   \`\`\`javascript
   sap.ui.getCore().applyTheme("${themeId}");
   \`\`\`

## Theme Colors

- **Brand Color**: ${brandColor}
- **Focus Color**: ${focusColor}
- **Shell Color**: ${shellColor}

${description ? `\n## Description\n\n${description}\n` : ''}

---

Generated with [OpenUI5 Theme Designer](https://github.com/simplifierag/theme-designer)
`;

		await fs.writeFile(path.join(tempDir, 'README.md'), readme);

		// Create ZIP archive
		console.log('[Export] Creating ZIP archive...');
		const archive = archiver('zip', {
			zlib: { level: 9 }
		});

		// Set response headers
		res.attachment(`${themeId}.zip`);
		res.setHeader('Content-Type', 'application/zip');

		// Pipe archive to response
		archive.pipe(res);

		// Add README.md and exportThemesInfo.json to root of ZIP
		archive.file(path.join(tempDir, 'README.md'), { name: 'README.md' });
		archive.file(path.join(tempDir, 'exportThemesInfo.json'), { name: 'exportThemesInfo.json' });

		// Add UI5 folder with all themes (this adds the UI5 prefix to the directory structure)
		archive.directory(themeRootDir, 'UI5');

		// Finalize archive
		await archive.finalize();

		console.log('[Export] ZIP archive sent successfully');

		// Cleanup temp directory after a delay
		setTimeout(async () => {
			try {
				await fs.rm(tempDir, { recursive: true, force: true });
				console.log(`[Export] Cleaned up temp directory: ${tempDir}`);
			} catch (error) {
				console.error(`[Export] Failed to cleanup temp directory:`, error);
			}
		}, 5000);

	} catch (error) {
		console.error('[Export] Compilation error:', error);
		res.status(500).json({
			error: 'Failed to compile theme',
			details: error.message,
			ui5Version: UI5_VERSION
		});
	}
});

// ========================================
// Start Server
// ========================================

app.listen(port, () => {
	console.log('='.repeat(60));
	console.log('Theme Builder API Server');
	console.log('='.repeat(60));
	console.log(`UI5 Version: ${UI5_VERSION}`);
	console.log(`Port: ${port}`);
	console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
	console.log('='.repeat(60));
	console.log('Endpoints:');
	console.log(`  GET  /health`);
	console.log(`  GET  /api/theme-defaults/:baseTheme`);
	console.log(`  POST /api/preview-theme`);
	console.log(`  POST /api/compile-theme`);
	console.log('='.repeat(60));
});
