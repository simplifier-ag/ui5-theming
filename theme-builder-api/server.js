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
const crypto = require('crypto');
const fs = require('fs').promises;
const fssync = require('fs');
const archiver = require('archiver');
const Mustache = require('mustache');
const ThemeBuilder = require('./theme-builder');
const { VALID_BASE_THEMES } = ThemeBuilder;

const app = express();
const port = process.env.PORT || 3000;
const UI5_VERSION = process.env.UI5_VERSION || '1.96.40';

// Shared directory for files uploaded via theme-designer-app.
// Must point to the same path as SHARED_DIR in theme-designer-app.
// Structure: <SHARED_DIR>/files/<themeId>/<filename>
const SHARED_DIR = process.env.SHARED_DIR || path.join(__dirname, '..', 'theme-designer-app', 'server', 'data', 'shared');

// Preview files live in preview/ — view XML can be overridden via Docker volume
const PREVIEW_DIR = path.join(__dirname, 'preview');
const PREVIEW_VIEW_XML = fssync.readFileSync(path.join(PREVIEW_DIR, 'Preview.view.xml'), 'utf8');
const PREVIEW_TEMPLATE = fssync.readFileSync(path.join(PREVIEW_DIR, 'index.html.mustache'), 'utf8');

// In-memory CSS cache: cacheKey → { libs: Map<libraryName, css>, expiresAt: number }
const previewCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Returns the absolute filesystem path for a theme file on the shared volume.
 * Structure mirrors DATABASE_DIR/files/<themeId>/<filename> in theme-designer-app.
 */
function getSharedFilePath(themeId, filename) {
	return path.join(SHARED_DIR, 'files', String(themeId), filename);
}

/**
 * Converts an image filename to its auto-generated LESS/CSS parameter name.
 * logo.png          → themeImageLogo
 * background.png    → themeImageBackground
 * my-header.png     → themeImageMyHeader
 * company_logo.png  → themeImageCompanyLogo
 *
 * NOTE: Must stay in sync with filenameToLessParam() in theme-designer-app/server/server.js
 * (used there only for display purposes in the image list API).
 */
function filenameToLessParam(filename) {
	const base = path.basename(filename, path.extname(filename));
	const words = base.split(/[-_\s]+/).filter(Boolean);
	const pascal = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
	return 'themeImage' + pascal;
}

/**
 * Builds a LESS variable block from an image list.
 * Always uses relative url('images/<filename>') — identical in preview and export.
 */
function buildImageLessVars(images) {
	return images
		.map(img => `@${filenameToLessParam(img.filename)}: url('images/${img.filename}');`)
		.join('\n');
}

function getCacheKey(params) {
	return crypto
		.createHash('sha256')
		.update(JSON.stringify(params))
		.digest('hex')
		.substring(0, 16);
}

function evictExpiredCache() {
	const now = Date.now();
	for (const [key, entry] of previewCache) {
		if (entry.expiresAt < now) previewCache.delete(key);
	}
}

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
		},
		sap_fiori_3_dark: {
			brandColor: '#0a6ed1',
			focusColor: '#0a6ed1',
			shellColor: '#29313a'
		},
		sap_fiori_3_hcb: {
			brandColor: '#ffffff',
			focusColor: '#ffffff',
			shellColor: '#000000'
		},
		sap_fiori_3_hcw: {
			brandColor: '#000000',
			focusColor: '#000000',
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
 * POST /api/preview-compile - Compile theme and cache it. Returns a short cache key.
 *
 * The key is then used in GET /api/preview-page?key=... to load the preview iframe.
 * Splitting compile (POST) from page delivery (GET) allows sending large customCss
 * in the request body instead of cramming everything into query parameters.
 */
app.post('/api/preview-compile', async (req, res) => {
	try {
		const { baseTheme = 'sap_fiori_3', brandColor, focusColor, shellColor, customCss = '', backgroundImage = '', version, files = [] } = req.body;

		const resolvedBaseTheme = VALID_BASE_THEMES.includes(baseTheme) ? baseTheme : 'sap_fiori_3';
		const defaults = getThemeDefaults(resolvedBaseTheme);

		// Identical LESS var generation as in export — url('images/<filename>') relative paths.
		// Images are served via preview-resources just like CSS and fonts.
		const imageFiles = files.filter(f => f.type === 'image');
		let effectiveCustomCss = customCss;
		if (imageFiles.length > 0) {
			effectiveCustomCss = buildImageLessVars(imageFiles) + '\n' + effectiveCustomCss;
		}
		if (backgroundImage && imageFiles.some(f => f.filename === backgroundImage)) {
			const paramName = filenameToLessParam(backgroundImage);
			effectiveCustomCss += `\n.sapUiGlobalBackgroundImage {\n\tbackground-image: @${paramName} !important;\n}`;
		}

		const compileParams = {
			baseTheme: resolvedBaseTheme,
			brandColor: brandColor || defaults.brandColor,
			focusColor: focusColor || defaults.focusColor,
			shellColor: shellColor || defaults.shellColor,
			customCss: effectiveCustomCss
		};

		const cacheKey = getCacheKey(compileParams);

		evictExpiredCache();
		if (!previewCache.has(cacheKey)) {
			console.log(`[Preview Compile] Compiling — base: ${resolvedBaseTheme}, brand: ${compileParams.brandColor} [key: ${cacheKey}]`);
			const libs = await themeBuilder.compilePreviewLibraries(compileParams);
			previewCache.set(cacheKey, {
				libs,
				params: compileParams,
				files: imageFiles,   // cached so preview-resources can serve images
				expiresAt: Date.now() + CACHE_TTL_MS
			});
		} else {
			console.log(`[Preview Compile] Cache hit [key: ${cacheKey}]`);
		}

		res.json({ key: cacheKey });

	} catch (error) {
		console.error('[Preview Compile] Error:', error);
		res.status(500).json({ error: error.message });
	}
});

/**
 * GET /api/preview-page?key=... - Render the preview HTML for a compiled cache key.
 *
 * UI5 loads with data-sap-ui-theme-roots pointing to /api/preview-resources/{key}/
 * so it fetches only our compiled CSS — no CDN base theme.
 */
app.get('/api/preview-page', (req, res) => {
	const { key, version } = req.query;

	const entry = previewCache.get(key);
	if (!entry || entry.expiresAt < Date.now()) {
		return res.status(404).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:1rem">
			<h3>Preview expired or not found</h3><p>Please trigger a new preview.</p>
		</body></html>`);
	}

	const ui5Version = version || UI5_VERSION;
	const html = Mustache.render(PREVIEW_TEMPLATE, {
		ui5Version,
		themeRootsUrl: `/api/preview-resources/${key}`,
		viewXmlJson: JSON.stringify(PREVIEW_VIEW_XML)
	});

	res.setHeader('Content-Type', 'text/html');
	res.send(html);
});

const FONT_MIME_TYPES = {
	'.woff2': 'font/woff2',
	'.woff': 'font/woff',
	'.ttf': 'font/ttf',
	'.eot': 'application/vnd.ms-fontobject',
	'.otf': 'font/otf'
};

/**
 * GET /api/preview-resources/:cacheKey/* - Serve CSS, JSON params, and font files for UI5 theme-roots.
 */
app.get('/api/preview-resources/:cacheKey/*', async (req, res) => {
	const { cacheKey } = req.params;
	const wildcardPath = req.params[0]; // e.g. "sap/ui/core/themes/preview_theme/library.css"

	const entry = previewCache.get(cacheKey);
	if (!entry || entry.expiresAt < Date.now()) {
		return res.status(404).send('/* Preview cache expired or not found */');
	}

	// Extract library name: "sap/m/themes/..." → "sap.m"
	const themePos = wildcardPath.indexOf('/themes/');
	if (themePos === -1) return res.status(404).send('/* Invalid path */');

	const libraryName = wildcardPath.substring(0, themePos).replace(/\//g, '.');

	// library-parameters.json — identical to export: colors + image params
	if (wildcardPath.endsWith('/library-parameters.json')) {
		const p = entry.params;
		const imageParams = {};
		for (const f of (entry.files || [])) {
			imageParams[filenameToLessParam(f.filename)] = `url('images/${f.filename}')`;
		}
		res.setHeader('Content-Type', 'application/json');
		return res.json({
			sapBrandColor: p.brandColor,
			sapContent_FocusColor: p.focusColor,
			sapShellColor: p.shellColor,
			...imageParams
		});
	}

	// Image files — serve from shared volume (same files as in the export ZIP)
	const imagesMatch = wildcardPath.match(/\/images\/([^/]+)$/);
	if (imagesMatch) {
		const filename = imagesMatch[1];
		const fileEntry = (entry.files || []).find(f => f.filename === filename);
		if (!fileEntry) return res.status(404).send('Image not found in cache');
		const filePath = getSharedFilePath(fileEntry.themeId, filename);
		try {
			const data = await fs.readFile(filePath);
			res.setHeader('Content-Type', fileEntry.mimeType || 'application/octet-stream');
			return res.send(data);
		} catch {
			return res.status(404).send('Image file not found on disk');
		}
	}

	// Font files — serve directly from the @openui5 npm packages
	const ext = path.extname(wildcardPath);
	if (FONT_MIME_TYPES[ext]) {
		const fontFileName = path.basename(wildcardPath);
		// Try theme-specific fonts first (72-* fonts)
		const fontsDir = themeBuilder.getFontsDir(entry.params.baseTheme, libraryName);
		const fontPath = path.join(fontsDir, fontFileName);
		if (fssync.existsSync(fontPath)) {
			res.setHeader('Content-Type', FONT_MIME_TYPES[ext]);
			return res.send(fssync.readFileSync(fontPath));
		}
		// Fall back to base fonts (SAP-icons lives under themes/base/fonts/)
		const baseFontPath = path.join(themeBuilder.getBaseFontsDir(libraryName), fontFileName);
		if (fssync.existsSync(baseFontPath)) {
			res.setHeader('Content-Type', FONT_MIME_TYPES[ext]);
			return res.send(fssync.readFileSync(baseFontPath));
		}
		return res.status(404).send('/* Font not found */');
	}

	// Default: compiled CSS
	const css = entry.libs.get(libraryName);
	if (!css) return res.status(404).send(`/* No CSS for library: ${libraryName} */`);

	res.setHeader('Content-Type', 'text/css');
	res.send(css);
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
		const { themeId, themeName, baseTheme, brandColor, focusColor, shellColor, customCss, backgroundImage = '', description, files = [] } = req.body;

		const imageFiles = files.filter(f => f.type === 'image');

		console.log(`[Export] UI5 ${UI5_VERSION} - Theme: ${themeId} (${themeName})`);
		console.log(`[Export] Base: ${baseTheme}, Brand: ${brandColor}, Files: ${files.length} (${imageFiles.length} images)`);

		// Validate input
		if (!themeId || !themeName || !baseTheme || !brandColor) {
			return res.status(400).json({ error: 'Missing required parameters: themeId, themeName, baseTheme, brandColor' });
		}

		// Validate baseTheme
		if (!baseTheme || !VALID_BASE_THEMES.includes(baseTheme)) {
			return res.status(400).json({
				error: 'Invalid base theme',
				message: `Base theme must be one of: ${VALID_BASE_THEMES.join(', ')}`
			});
		}

		let effectiveCustomCss = customCss || '';
		if (imageFiles.length > 0) {
			effectiveCustomCss = buildImageLessVars(imageFiles) + '\n' + effectiveCustomCss;
		}
		if (backgroundImage && imageFiles.some(f => f.filename === backgroundImage)) {
			const paramName = filenameToLessParam(backgroundImage);
			effectiveCustomCss += `\n.sapUiGlobalBackgroundImage {\n\tbackground-image: @${paramName} !important;\n}`;
		}

		// Build image parameters map for library-parameters.json
		const imageParams = {};
		for (const f of imageFiles) {
			imageParams[filenameToLessParam(f.filename)] = `url('images/${f.filename}')`;
		}

		// Build complete theme using ThemeBuilder
		console.log('[Export] Building theme with ThemeBuilder...');
		const themeResults = await themeBuilder.buildTheme({
			themeName: themeId,  // Use themeId as technical directory name
			brandColor,
			focusColor,
			shellColor,
			customCss: effectiveCustomCss,
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

			const fixedCss = themeBuilder.fixFontPaths(result.css, libraryName, baseTheme);
			const fixedCssRtl = themeBuilder.fixFontPaths(result.cssRtl, libraryName, baseTheme);

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

			// Create library-parameters.json (theme parameters incl. image params)
			const parameters = {
				sapBrandColor: brandColor,
				sapContent_FocusColor: focusColor,
				sapShellColor: shellColor,
				...imageParams   // e.g. themeImageLogo: "url('images/logo.png')"
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
				const targetFontsDir = path.join(libraryThemeDir, 'fonts');
				await fs.mkdir(targetFontsDir, { recursive: true });

				// Copy theme-specific fonts (72-*)
				const themeFontsDir = themeBuilder.getFontsDir(baseTheme);
				try {
					await fs.access(themeFontsDir);
					const fontFiles = await fs.readdir(themeFontsDir);
					for (const fontFile of fontFiles) {
						await fs.copyFile(path.join(themeFontsDir, fontFile), path.join(targetFontsDir, fontFile));
						console.log(`[Export]   Copied font: ${fontFile}`);
					}
				} catch (error) {
					console.warn(`[Export] Warning: Could not copy theme fonts from ${themeFontsDir}:`, error.message);
				}

				// Copy base fonts (SAP-icons and other icon fonts live under themes/base/fonts/)
				const baseFontsDir = themeBuilder.getBaseFontsDir();
				try {
					await fs.access(baseFontsDir);
					const fontFiles = await fs.readdir(baseFontsDir);
					for (const fontFile of fontFiles) {
						const targetPath = path.join(targetFontsDir, fontFile);
						if (!fssync.existsSync(targetPath)) {
							await fs.copyFile(path.join(baseFontsDir, fontFile), targetPath);
							console.log(`[Export]   Copied base font: ${fontFile}`);
						}
					}
				} catch (error) {
					console.warn(`[Export] Warning: Could not copy base fonts from ${baseFontsDir}:`, error.message);
				}

			}

		// Copy uploaded images into every library's images/ folder.
		// Custom CSS with url('images/X') is compiled into all libraries, so the image
		// must be resolvable from each library's CSS location — not just sap.ui.core.
		if (imageFiles.length > 0) {
			const imagesTargetDir = path.join(libraryThemeDir, 'images');
			await fs.mkdir(imagesTargetDir, { recursive: true });
			for (const f of imageFiles) {
				const srcPath = getSharedFilePath(f.themeId, f.filename);
				try {
					await fs.copyFile(srcPath, path.join(imagesTargetDir, f.filename));
				} catch (e) {
					console.warn(`[Export]   Could not copy image ${f.filename} to ${libraryName}: ${e.message}`);
				}
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
	console.log(`  POST /api/preview-compile`);
	console.log(`  GET  /api/preview-page`);
	console.log(`  GET  /api/preview-resources/:key/*`);
	console.log(`  POST /api/compile-theme`);
	console.log('='.repeat(60));
});
