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

const FONT_FORMAT = { '.woff2': 'woff2', '.woff': 'woff', '.ttf': 'truetype', '.otf': 'opentype' };

/**
 * Builds a CSS @font-face block for each uploaded font.
 * Font-family name = filename without extension (e.g. "my-brand-font.woff2" → "my-brand-font").
 * URL uses relative path url('fonts/<filename>') — works from every library directory.
 */
function buildFontFaceCss(fontFiles) {
	return fontFiles.map(f => {
		const ext  = path.extname(f.filename).toLowerCase();
		const fmt  = FONT_FORMAT[ext] || 'truetype';
		const name = path.basename(f.filename, path.extname(f.filename));
		return `@font-face {\n  font-family: "${name}";\n  src: url('fonts/${f.filename}') format('${fmt}');\n  font-weight: normal;\n  font-style: normal;\n}`;
	}).join('\n');
}

/**
 * Splits files by type and builds effectiveCustomCss + imageParams from them.
 * Shared pre-processing step for both preview-compile and compile-theme.
 */
function prepareThemeParams({ customCss = '', backgroundImage = '', files = [] }) {
	const imageFiles = files.filter(f => f.type === 'image');
	const fontFiles  = files.filter(f => f.type === 'font');

	let effectiveCustomCss = customCss;
	if (fontFiles.length > 0)  effectiveCustomCss = buildFontFaceCss(fontFiles)   + '\n' + effectiveCustomCss;
	if (imageFiles.length > 0) effectiveCustomCss = buildImageLessVars(imageFiles) + '\n' + effectiveCustomCss;
	if (backgroundImage && imageFiles.some(f => f.filename === backgroundImage)) {
		effectiveCustomCss += `\n.sapUiGlobalBackgroundImage {\n\tbackground-image: @${filenameToLessParam(backgroundImage)} !important;\n}`;
	}

	const imageParams = Object.fromEntries(
		imageFiles.map(f => [filenameToLessParam(f.filename), `url('images/${f.filename}')`])
	);

	return { imageFiles, fontFiles, effectiveCustomCss, imageParams };
}

/**
 * Validates and resolves all shared theme parameters from a request body.
 * Throws an error with statusCode=400 on invalid input.
 * Returns fully resolved params — identical shape for both preview and export.
 */
function resolveThemeParams(body) {
	const {
		baseTheme,
		brandColor, focusColor, shellColor,
		customCss = '', backgroundImage = '', files = []
	} = body;

	if (!VALID_BASE_THEMES.includes(baseTheme)) {
		const err = new Error(`Invalid base theme. Must be one of: ${VALID_BASE_THEMES.join(', ')}`);
		err.statusCode = 400;
		throw err;
	}

	const defaults = getThemeDefaults(baseTheme);
	const resolvedBrand = brandColor || defaults.brandColor;
	const resolvedFocus = focusColor || defaults.focusColor;
	const resolvedShell = shellColor || defaults.shellColor;

	const { imageFiles, fontFiles, effectiveCustomCss, imageParams } = prepareThemeParams({ customCss, backgroundImage, files });

	return {
		baseTheme,
		brandColor:  resolvedBrand,
		focusColor:  resolvedFocus,
		shellColor:  resolvedShell,
		customCss,           // raw — export needs this for custom.less
		effectiveCustomCss,
		imageFiles, fontFiles, imageParams,
		files                // kept for cache key
	};
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
		if (entry.expiresAt < now) {
			previewCache.delete(key);
			if (entry.dir) fs.rm(entry.dir, { recursive: true, force: true }).catch(() => {});
		}
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
 * Compiles a complete theme and writes all files (CSS, fonts, images) to outputDir.
 * Shared by preview and export — identical output, caller decides what to do with it.
 * Returns the raw themeResults (needed by export for exportThemesInfo.json).
 */
async function buildThemeToDir({ themeId, themeName, baseTheme, brandColor, focusColor, shellColor, effectiveCustomCss, description, imageFiles, fontFiles, imageParams }, outputDir) {
	const themeResults = await themeBuilder.buildTheme({
		themeName: themeId,
		brandColor, focusColor, shellColor,
		customCss: effectiveCustomCss,
		baseTheme,
		uniqueId: path.basename(outputDir)
	});

	for (const [libraryName, result] of Object.entries(themeResults)) {
		const libraryThemeDir = path.join(outputDir, libraryName.replace(/\./g, '/'), 'themes', themeId);
		await fs.mkdir(libraryThemeDir, { recursive: true });

		await fs.writeFile(path.join(libraryThemeDir, 'library.css'),     themeBuilder.fixFontPaths(result.css,    libraryName, baseTheme));
		await fs.writeFile(path.join(libraryThemeDir, 'library-RTL.css'), themeBuilder.fixFontPaths(result.cssRtl, libraryName, baseTheme));

		await fs.writeFile(path.join(libraryThemeDir, '.theming'), JSON.stringify({
			sEntity: "Theme", sId: themeId, sVendor: "Custom",
			oExtends: baseTheme, sDescription: description || `Custom theme ${themeId}`,
			sLabel: themeName || themeId, sVersion: UI5_VERSION
		}, null, 2));

		await fs.writeFile(path.join(libraryThemeDir, 'library-parameters.json'), JSON.stringify({
			sapBrandColor: brandColor, sapContent_FocusColor: focusColor, sapShellColor: shellColor,
			...imageParams
		}, null, 2));

		// SAP system fonts — only needed in sap.ui.core
		if (libraryName === 'sap.ui.core') {
			const targetFontsDir = path.join(libraryThemeDir, 'fonts');
			await fs.mkdir(targetFontsDir, { recursive: true });
			for (const [fontsDir, label] of [[themeBuilder.getFontsDir(baseTheme), 'theme'], [themeBuilder.getBaseFontsDir(), 'base']]) {
				try {
					for (const file of await fs.readdir(fontsDir)) {
						const dest = path.join(targetFontsDir, file);
						if (!fssync.existsSync(dest)) await fs.copyFile(path.join(fontsDir, file), dest);
					}
				} catch (e) { console.warn(`[Build] Could not copy ${label} fonts: ${e.message}`); }
			}
		}

		// Uploaded images — every library needs them (CSS url('images/X') is in every library's CSS)
		if (imageFiles.length > 0) {
			const imagesDir = path.join(libraryThemeDir, 'images');
			await fs.mkdir(imagesDir, { recursive: true });
			for (const f of imageFiles) {
				try { await fs.copyFile(getSharedFilePath(f.themeId, f.filename), path.join(imagesDir, f.filename)); }
				catch (e) { console.warn(`[Build] Could not copy image ${f.filename}: ${e.message}`); }
			}
		}

		// Uploaded fonts — every library needs them (same reason as images)
		if (fontFiles.length > 0) {
			const fontsDir = path.join(libraryThemeDir, 'fonts');
			await fs.mkdir(fontsDir, { recursive: true });
			for (const f of fontFiles) {
				try { await fs.copyFile(getSharedFilePath(f.themeId, f.filename), path.join(fontsDir, f.filename)); }
				catch (e) { console.warn(`[Build] Could not copy font ${f.filename}: ${e.message}`); }
			}
		}
	}

	return themeResults;
}

/**
 * POST /api/preview-compile - Compile theme and cache it. Returns a short cache key.
 *
 * The key is then used in GET /api/preview-page?key=... to load the preview iframe.
 * Splitting compile (POST) from page delivery (GET) allows sending large customCss
 * in the request body instead of cramming everything into query parameters.
 */
app.post('/api/preview-compile', async (req, res) => {
	try {
		const { baseTheme, brandColor, focusColor, shellColor, effectiveCustomCss, imageFiles, fontFiles, imageParams, files } = resolveThemeParams(req.body);

		// Include filenames in cache key so adding/removing a file invalidates the cache
		const cacheKey = getCacheKey({
			baseTheme, brandColor, focusColor, shellColor,
			customCss: effectiveCustomCss,
			fileKeys: files.map(f => f.filename).sort().join(',')
		});

		evictExpiredCache();
		if (!previewCache.has(cacheKey)) {
			console.log(`[Preview] Compiling — base: ${baseTheme}, brand: ${brandColor} [key: ${cacheKey}]`);
			const tempDir = path.join(__dirname, 'temp', `preview_${cacheKey}`);
			await fs.mkdir(tempDir, { recursive: true });

			await buildThemeToDir({
				themeId: 'preview_theme', themeName: 'Preview Theme',
				baseTheme, brandColor, focusColor, shellColor,
				effectiveCustomCss, description: '', imageFiles, fontFiles, imageParams
			}, tempDir);

			previewCache.set(cacheKey, { dir: tempDir, expiresAt: Date.now() + CACHE_TTL_MS });
		} else {
			console.log(`[Preview] Cache hit [key: ${cacheKey}]`);
		}

		res.json({ key: cacheKey });

	} catch (error) {
		if (error.statusCode === 400) return res.status(400).json({ error: error.message });
		console.error('[Preview] Error:', error);
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

/**
 * GET /api/preview-resources/:cacheKey/* - Serve compiled theme files directly from the cached temp dir.
 * All files (CSS, fonts, images, JSON) are already written to disk by buildThemeToDir — no special casing needed.
 */
app.get('/api/preview-resources/:cacheKey/*', (req, res) => {
	const entry = previewCache.get(req.params.cacheKey);
	if (!entry || entry.expiresAt < Date.now()) {
		return res.status(404).send('/* Preview cache expired or not found */');
	}

	const filePath = path.resolve(entry.dir, req.params[0]);
	// Guard against path traversal
	if (!filePath.startsWith(entry.dir + path.sep)) {
		return res.status(400).send('/* Invalid path */');
	}

	res.sendFile(filePath, err => {
		if (err && !res.headersSent) res.status(404).send('/* Not found */');
	});
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
		const { themeId, themeName, description } = req.body;

		if (!themeId || !themeName) {
			return res.status(400).json({ error: 'Missing required parameters: themeId, themeName' });
		}

		const { baseTheme, brandColor, focusColor, shellColor, customCss, effectiveCustomCss, imageFiles, fontFiles, imageParams } = resolveThemeParams(req.body);

		console.log(`[Export] UI5 ${UI5_VERSION} - Theme: ${themeId} (${themeName}), base: ${baseTheme}, brand: ${brandColor}, files: ${imageFiles.length} images / ${fontFiles.length} fonts`);

		// Create temporary directories
		const tempDir = path.join(__dirname, 'temp', themeId);
		const metaDir = path.join(__dirname, 'temp', `${themeId}_meta`);
		await fs.mkdir(tempDir, { recursive: true });
		await fs.mkdir(metaDir, { recursive: true });

		// Build theme and write all files to tempDir (same code path as preview)
		console.log('[Export] Building theme...');
		const themeResults = await buildThemeToDir({
			themeId, themeName, baseTheme,
			brandColor, focusColor, shellColor,
			effectiveCustomCss, description, imageFiles, fontFiles, imageParams
		}, tempDir);

		// Write custom.less into sap.ui.core for SAP Theme Designer re-import compatibility
		if (customCss && customCss.trim() !== '' && customCss.trim() !== '/* Add your custom CSS here */') {
			const coreThemeDir = path.join(tempDir, 'sap', 'ui', 'core', 'themes', themeId);
			await fs.writeFile(
				path.join(coreThemeDir, 'custom.less'),
				`/*<SAP_FREETEXT_LESS>*/${customCss}/*</SAP_FREETEXT_LESS>*/`
			).catch(e => console.warn('[Export] Could not write custom.less:', e.message));
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
						textDirections: ["LTR", "RTL"],
						backgroundImage: req.body.backgroundImage || '',
						customFonts: fontFiles.map(f => f.filename)
					}
				}
			}
		};

		await fs.writeFile(
			path.join(metaDir, 'exportThemesInfo.json'),
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

		await fs.writeFile(path.join(metaDir, 'README.md'), readme);

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
		archive.file(path.join(metaDir, 'README.md'), { name: 'README.md' });
		archive.file(path.join(metaDir, 'exportThemesInfo.json'), { name: 'exportThemesInfo.json' });

		// Add UI5 folder with all themes (this adds the UI5 prefix to the directory structure)
		archive.directory(tempDir, 'UI5');

		// Finalize archive
		await archive.finalize();

		console.log('[Export] ZIP archive sent successfully');

		// Cleanup temp directories after a delay
		setTimeout(async () => {
			try {
				await fs.rm(tempDir, { recursive: true, force: true });
				await fs.rm(metaDir, { recursive: true, force: true });
				console.log(`[Export] Cleaned up temp directories: ${tempDir}, ${metaDir}`);
			} catch (error) {
				console.error(`[Export] Failed to cleanup temp directories:`, error);
			}
		}, 5000);

	} catch (error) {
		if (error.statusCode === 400) return res.status(400).json({ error: error.message });
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
