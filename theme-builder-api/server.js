/**
 * Theme Builder API - Stateless Theme Compilation Service
 *
 * Endpoints:
 * - POST /api/preview-compile        Compile theme and return a cache key
 * - GET  /api/preview-page?key=...   Render the preview HTML page
 * - GET  /api/preview-resources/:key/* Serve compiled theme files from cache
 * - POST /api/compile-theme          Compile full theme ZIP export
 * - GET  /api/theme-defaults/:base   Default colors for a base theme
 * - GET  /health                     Health check
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
// Must match SHARED_DIR in theme-designer-app. Structure: <SHARED_DIR>/files/<themeId>/<filename>
const SHARED_DIR = process.env.SHARED_DIR || path.join(__dirname, '..', 'theme-designer-app', 'server', 'data', 'shared');

const PREVIEW_DIR = path.join(__dirname, 'preview');
const PREVIEW_VIEW_XML = fssync.readFileSync(path.join(PREVIEW_DIR, 'Preview.view.xml'), 'utf8');
const PREVIEW_TEMPLATE = fssync.readFileSync(path.join(PREVIEW_DIR, 'index.html.mustache'), 'utf8');

// Preview cache: cacheKey → { dir: string, expiresAt: number }
const previewCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const themeBuilder = new ThemeBuilder();

// ============================================================
// Helpers
// ============================================================

function getSharedFilePath(themeId, filename) {
	return path.join(SHARED_DIR, 'files', String(themeId), filename);
}

/**
 * Converts a filename to its auto-generated LESS parameter name.
 * logo.png → themeImageLogo, my-header.png → themeImageMyHeader
 * Must stay in sync with filenameToLessParam() in theme-designer-app/server/server.js.
 */
function filenameToLessParam(filename) {
	const base = path.basename(filename, path.extname(filename));
	const words = base.split(/[-_\s]+/).filter(Boolean);
	const pascal = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
	return 'themeImage' + pascal;
}

function buildImageLessVars(images) {
	return images
		.map(img => `@${filenameToLessParam(img.filename)}: url('./images/${img.filename}');`)
		.join('\n');
}

const FONT_FORMAT = { '.woff2': 'woff2', '.woff': 'woff', '.ttf': 'truetype', '.otf': 'opentype' };

function buildFontFaceCss(fontFiles) {
	return fontFiles.map(f => {
		const ext  = path.extname(f.filename).toLowerCase();
		const fmt  = FONT_FORMAT[ext] || 'truetype';
		const name = path.basename(f.filename, path.extname(f.filename));
		return `@font-face {\n  font-family: "${name}";\n  src: url('./fonts/${f.filename}') format('${fmt}');\n  font-weight: normal;\n  font-style: normal;\n}`;
	}).join('\n');
}

// base.less: imported by every library — color overrides + image LESS vars + @import "custom.less"
function buildBaseLessContent(brandColor, focusColor, shellColor, imageFiles, hasCustomCss) {
	let content = `@sapBrandColor: ${brandColor};\n@sapContent_FocusColor: ${focusColor};\n@sapShellColor: ${shellColor};\n`;
	if (imageFiles.length > 0) content += '\n' + buildImageLessVars(imageFiles) + '\n';
	if (hasCustomCss) content += '\n@import "custom.less";\n';
	return content;
}

// core_extra.less: imported only by sap.ui.core — @font-face + background image selector
function buildCoreExtraContent(fontFiles, backgroundImage, imageFiles) {
	let content = '';
	if (fontFiles.length > 0) content += buildFontFaceCss(fontFiles) + '\n';
	if (backgroundImage && imageFiles.some(f => f.filename === backgroundImage)) {
		content += `.sapUiGlobalBackgroundImage {\n\tbackground-image: @${filenameToLessParam(backgroundImage)} !important;\n}\n`;
	}
	return content;
}

function getThemeDefaults(baseTheme) {
	const defaults = {
		sap_horizon:      { brandColor: '#0070f2', focusColor: '#0032a5', shellColor: '#ffffff' },
		sap_fiori_3:      { brandColor: '#0a6ed1', focusColor: '#000000', shellColor: '#354a5f' },
		sap_fiori_3_dark: { brandColor: '#0a6ed1', focusColor: '#0a6ed1', shellColor: '#29313a' },
		sap_fiori_3_hcb:  { brandColor: '#ffffff', focusColor: '#ffffff', shellColor: '#000000' },
		sap_fiori_3_hcw:  { brandColor: '#000000', focusColor: '#000000', shellColor: '#ffffff' }
	};
	return defaults[baseTheme] || defaults.sap_horizon;
}

/**
 * Validates and resolves all shared theme parameters from a request body.
 * Throws an error with statusCode=400 on invalid input.
 */
function resolveThemeParams(body) {
	const { baseTheme, brandColor, focusColor, shellColor, customCss = '', backgroundImage = '', files = [] } = body;

	if (!VALID_BASE_THEMES.includes(baseTheme)) {
		const err = new Error(`Invalid base theme. Must be one of: ${VALID_BASE_THEMES.join(', ')}`);
		err.statusCode = 400;
		throw err;
	}

	const def = getThemeDefaults(baseTheme);
	const resolvedBrand = brandColor || def.brandColor;
	const resolvedFocus = focusColor || def.focusColor;
	const resolvedShell = shellColor || def.shellColor;

	const imageFiles = files.filter(f => f.type === 'image');
	const fontFiles  = files.filter(f => f.type === 'font');
	const hasCustomCss = !!(customCss && customCss.trim());

	const baseLessContent  = buildBaseLessContent(resolvedBrand, resolvedFocus, resolvedShell, imageFiles, hasCustomCss);
	const coreExtraContent = buildCoreExtraContent(fontFiles, backgroundImage, imageFiles);
	const imageParams = Object.fromEntries(
		imageFiles.map(f => [filenameToLessParam(f.filename), `url('./images/${f.filename}')`])
	);

	return {
		baseTheme,
		brandColor:  resolvedBrand,
		focusColor:  resolvedFocus,
		shellColor:  resolvedShell,
		customCss,
		backgroundImage,
		baseLessContent,
		coreExtraContent,
		imageFiles, fontFiles, imageParams,
		files  // kept for cache key
	};
}

function getCacheKey(params) {
	return crypto.createHash('sha256').update(JSON.stringify(params)).digest('hex').substring(0, 16);
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

/**
 * Compiles a complete theme and writes all files (CSS, fonts, images) to outputDir.
 * Shared by preview and export — identical output, caller decides what to do with it.
 * Returns the raw themeResults (keys = library names, needed by export for exportThemesInfo.json).
 */
async function buildThemeToDir({ themeId, themeName, baseTheme, brandColor, focusColor, shellColor, baseLessContent, coreExtraContent, customCss, description, imageFiles, fontFiles, imageParams }, outputDir) {
	// LESS temp files go to a separate dir so they don't end up in outputDir
	const lessUniqueId = path.basename(outputDir) + '_less';
	const lessTempDir = path.join(__dirname, 'temp', lessUniqueId);
	const coreThemeTempDir = themeBuilder.getCoreThemeDir(lessUniqueId, themeId);

	// Copy fonts and images into the temp dir BEFORE compilation so that
	// less-openui5 can resolve url() paths relative to the LESS files.
	// This way the compiler automatically generates correct relative paths
	// for each library — no post-compilation fixup needed.
	const tempFontsDir = path.join(coreThemeTempDir, 'fonts');
	await fs.mkdir(tempFontsDir, { recursive: true });
	for (const [fontsDir, label] of [[themeBuilder.getFontsDir(baseTheme), 'theme'], [themeBuilder.getBaseFontsDir(), 'base']]) {
		try {
			for (const file of await fs.readdir(fontsDir)) {
				const dest = path.join(tempFontsDir, file);
				if (!fssync.existsSync(dest)) await fs.copyFile(path.join(fontsDir, file), dest);
			}
		} catch (e) { console.warn(`[Build] Could not copy ${label} fonts to temp: ${e.message}`); }
	}
	for (const f of fontFiles) {
		try { await fs.copyFile(getSharedFilePath(f.themeId, f.filename), path.join(tempFontsDir, f.filename)); }
		catch (e) { console.warn(`[Build] Could not copy font ${f.filename} to temp: ${e.message}`); }
	}

	if (imageFiles.length > 0) {
		const tempImagesDir = path.join(coreThemeTempDir, 'images');
		await fs.mkdir(tempImagesDir, { recursive: true });
		for (const f of imageFiles) {
			try { await fs.copyFile(getSharedFilePath(f.themeId, f.filename), path.join(tempImagesDir, f.filename)); }
			catch (e) { console.warn(`[Build] Could not copy image ${f.filename} to temp: ${e.message}`); }
		}
	}

	const themeResults = await themeBuilder.buildTheme({
		themeName: themeId, baseLessContent, coreExtraContent, customCss, baseTheme, uniqueId: lessUniqueId
	});

	// Copy the entire core theme temp dir (fonts, images, custom.less) to output
	const coreOutputDir = path.join(outputDir, 'sap', 'ui', 'core', 'themes', themeId);
	await fs.mkdir(coreOutputDir, { recursive: true });
	await fs.cp(coreThemeTempDir, coreOutputDir, { recursive: true }).catch(e => console.warn('[Build] Could not copy core theme dir:', e.message));

	await fs.rm(lessTempDir, { recursive: true, force: true }).catch(() => {});

	for (const [libraryName, result] of Object.entries(themeResults)) {
		const libraryThemeDir = path.join(outputDir, libraryName.replace(/\./g, '/'), 'themes', themeId);
		await fs.mkdir(libraryThemeDir, { recursive: true });

		await fs.writeFile(path.join(libraryThemeDir, 'library.css'),     themeBuilder.fixAssetPaths(result.css, baseTheme, themeId));
		await fs.writeFile(path.join(libraryThemeDir, 'library-RTL.css'), themeBuilder.fixAssetPaths(result.cssRtl, baseTheme, themeId));

		await fs.writeFile(path.join(libraryThemeDir, '.theming'), JSON.stringify({
			sEntity: "Theme", sId: themeId, sVendor: "Custom",
			oExtends: baseTheme, sDescription: description || `Custom theme ${themeId}`,
			sLabel: themeName || themeId, sVersion: UI5_VERSION
		}, null, 2));

		await fs.writeFile(path.join(libraryThemeDir, 'library-parameters.json'), JSON.stringify({
			sapBrandColor: brandColor, sapContent_FocusColor: focusColor, sapShellColor: shellColor,
			...imageParams
		}, null, 2));

	}

	return themeResults;
}

// ============================================================
// Middleware
// ============================================================

app.use(cors({ origin: '*', credentials: false }));
app.use(bodyParser.json());
app.use((req, res, next) => {
	console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
	next();
});

// ============================================================
// Endpoints
// ============================================================

app.get('/health', (req, res) => {
	res.json({ status: 'ok', message: 'Theme Builder API is running', ui5Version: UI5_VERSION, timestamp: new Date().toISOString() });
});

app.get('/api/theme-defaults/:baseTheme', (req, res) => {
	res.json(getThemeDefaults(req.params.baseTheme));
});

/**
 * POST /api/preview-compile
 * Compiles the theme, caches the result on disk, returns a short cache key.
 * The key is then used in GET /api/preview-page?key=... and /api/preview-resources/:key/*.
 */
app.post('/api/preview-compile', async (req, res) => {
	try {
		const { baseTheme, brandColor, focusColor, shellColor, baseLessContent, coreExtraContent, customCss, imageFiles, fontFiles, imageParams, files } = resolveThemeParams(req.body);

		const cacheKey = getCacheKey({
			baseTheme, brandColor, focusColor, shellColor,
			baseLessContent, coreExtraContent, customCss,
			fileKeys: files.map(f => `${f.filename}:${f.id || ''}:${f.size || ''}`).sort().join(',')
		});

		evictExpiredCache();
		if (!previewCache.has(cacheKey)) {
			console.log(`[Preview] Compiling — base: ${baseTheme}, brand: ${brandColor} [key: ${cacheKey}]`);
			const tempDir = path.join(__dirname, 'temp', `preview_${cacheKey}`);
			await fs.mkdir(tempDir, { recursive: true });

			await buildThemeToDir({
				themeId: 'preview_theme', themeName: 'Preview Theme',
				baseTheme, brandColor, focusColor, shellColor,
				baseLessContent, coreExtraContent, customCss, description: '', imageFiles, fontFiles, imageParams
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
 * GET /api/preview-page?key=...
 * Renders the preview HTML. UI5 loads with theme-roots pointing to /api/preview-resources/{key}/
 * so it fetches only our compiled CSS — no CDN base theme.
 */
app.get('/api/preview-page', (req, res) => {
	const { key, version } = req.query;
	const entry = previewCache.get(key);

	if (!entry || entry.expiresAt < Date.now()) {
		return res.status(404).send('<!DOCTYPE html><html><body style="font-family:sans-serif;padding:1rem"><h3>Preview expired or not found</h3><p>Please trigger a new preview.</p></body></html>');
	}

	res.setHeader('Content-Type', 'text/html');
	res.send(Mustache.render(PREVIEW_TEMPLATE, {
		ui5Version: version || UI5_VERSION,
		themeRootsUrl: `/api/preview-resources/${key}`,
		viewXmlJson: JSON.stringify(PREVIEW_VIEW_XML)
	}));
});

/**
 * GET /api/preview-resources/:cacheKey/*
 * Serves compiled theme files directly from the cached temp dir.
 */
app.get('/api/preview-resources/:cacheKey/*', (req, res) => {
	const entry = previewCache.get(req.params.cacheKey);
	if (!entry || entry.expiresAt < Date.now()) {
		return res.status(404).send('/* Preview cache expired or not found */');
	}

	const filePath = path.resolve(entry.dir, req.params[0]);
	if (!filePath.startsWith(entry.dir + path.sep)) {
		return res.status(400).send('/* Invalid path */');
	}

	res.sendFile(filePath, err => {
		if (err && !res.headersSent) res.status(404).send('/* Not found */');
	});
});

/**
 * POST /api/compile-theme
 * Compiles the full theme and streams a ZIP file.
 */
app.post('/api/compile-theme', async (req, res) => {
	try {
		const { themeId, themeName, description } = req.body;

		if (!themeId || !themeName) {
			return res.status(400).json({ error: 'Missing required parameters: themeId, themeName' });
		}

		const { baseTheme, brandColor, focusColor, shellColor, customCss, backgroundImage, baseLessContent, coreExtraContent, imageFiles, fontFiles, imageParams } = resolveThemeParams(req.body);

		console.log(`[Export] UI5 ${UI5_VERSION} — ${themeId} (${themeName}), base: ${baseTheme}, brand: ${brandColor}, files: ${imageFiles.length} images / ${fontFiles.length} fonts`);

		const tempDir = path.join(__dirname, 'temp', themeId);
		const metaDir = path.join(__dirname, 'temp', `${themeId}_meta`);
		await fs.mkdir(tempDir, { recursive: true });
		await fs.mkdir(metaDir, { recursive: true });

		const themeResults = await buildThemeToDir({
			themeId, themeName, baseTheme,
			brandColor, focusColor, shellColor,
			baseLessContent, coreExtraContent, customCss, description, imageFiles, fontFiles, imageParams
		}, tempDir);

		const exportThemesInfo = {
			zipInfo: {
				creatorName: "OpenUI5 Theme Designer", creatorVersion: "2.0.0",
				created: new Date().toISOString(), lessVersion: "3.13.1",
				compression: "none", exportMode: "ALL"
			},
			contentInfo: {
				frameworks: { openui5: { name: "OpenUI5", version: UI5_VERSION } },
				libraries: Object.fromEntries(Object.keys(themeResults).map(n => [n, { name: n, version: UI5_VERSION }])),
				themes: {
					[themeId]: {
						id: themeId, extends: baseTheme, label: themeName, vendor: "Custom",
						textDirections: ["LTR", "RTL"],
						backgroundImage,
						customFonts: fontFiles.map(f => f.filename)
					}
				}
			}
		};

		await fs.writeFile(path.join(metaDir, 'exportThemesInfo.json'), JSON.stringify(exportThemesInfo, null, 2));

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

		const archive = archiver('zip', { zlib: { level: 9 } });
		res.attachment(`${themeId}.zip`);
		res.setHeader('Content-Type', 'application/zip');
		archive.pipe(res);
		archive.file(path.join(metaDir, 'README.md'), { name: 'README.md' });
		archive.file(path.join(metaDir, 'exportThemesInfo.json'), { name: 'exportThemesInfo.json' });
		archive.directory(tempDir, 'UI5');
		await archive.finalize();

		console.log('[Export] ZIP archive sent successfully');

		setTimeout(async () => {
			await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
			await fs.rm(metaDir, { recursive: true, force: true }).catch(() => {});
		}, 5000);

	} catch (error) {
		if (error.statusCode === 400) return res.status(400).json({ error: error.message });
		console.error('[Export] Compilation error:', error);
		res.status(500).json({ error: 'Failed to compile theme', details: error.message, ui5Version: UI5_VERSION });
	}
});

// ============================================================
// Start Server
// ============================================================

app.listen(port, () => {
	console.log('='.repeat(60));
	console.log(`Theme Builder API  |  UI5 ${UI5_VERSION}  |  Port ${port}`);
	console.log('='.repeat(60));
});
