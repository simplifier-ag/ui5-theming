// Load environment variables from .env file (in parent directory)
// In Docker, environment variables are set via docker-compose.yml, so .env is optional
const path = require('path');
const dotenvPath = path.join(__dirname, '../../.env');
require('dotenv').config({ path: dotenvPath });

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const AdmZip = require('adm-zip');
const passport = require('passport');
const session = require('express-session');
const { Strategy: OpenIDConnectStrategy } = require('passport-openidconnect');
const BuilderRouter = require('./router');
const { statements, initialize } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Theme Builder Router for version-specific compilation
const builderRouter = new BuilderRouter();

// Trust proxy - required for secure cookies behind reverse proxy (Traefik/nginx)
// This enables Express to trust X-Forwarded-* headers
app.set('trust proxy', 1);

// Configure multer for file uploads (memory storage)
const upload = multer({ storage: multer.memoryStorage() });

// Keycloak OAuth Configuration
const KEYCLOAK_URL = process.env.KEYCLOAK_URL || '';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || '';
const CLIENT_ID = process.env.CLIENT_ID || '';
const CLIENT_SECRET = process.env.CLIENT_SECRET || '';

// Helper function to get the base URL from request
function getBaseUrl(req) {
	const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
	const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:8080';
	return `${protocol}://${host}`;
}

// Session Configuration
app.use(session({
	secret: process.env.SESSION_SECRET || 'theme-designer-secret-key-change-in-production',
	resave: false,
	saveUninitialized: false,
	cookie: {
		secure: process.env.NODE_ENV === 'production', // HTTPS only in production
		httpOnly: true,
		maxAge: 24 * 60 * 60 * 1000 // 24 hours
	}
}));

// Passport Configuration
// Note: callbackURL is set dynamically per request in the /auth/login handler
passport.use('oidc', new OpenIDConnectStrategy({
	issuer: `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`,
	authorizationURL: `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth`,
	tokenURL: `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`,
	userInfoURL: `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/userinfo`,
	clientID: CLIENT_ID,
	clientSecret: CLIENT_SECRET,
	callbackURL: 'http://localhost:8080/auth/callback', // Default fallback
	scope: ['openid', 'profile', 'email'],
	passReqToCallback: true  // Enable dynamic callbackURL from request
}, (req, issuer, profile, context, idToken, accessToken, refreshToken, done) => {
	// Store user info and ID token in session (needed for logout)
	return done(null, {
		id: profile.id,
		displayName: profile.displayName,
		email: profile.emails && profile.emails[0] ? profile.emails[0].value : null,
		idToken: idToken  // Store ID token for logout
	});
}));

passport.serializeUser((user, done) => {
	done(null, user);
});

passport.deserializeUser((user, done) => {
	done(null, user);
});

app.use(passport.initialize());
app.use(passport.session());

// Middleware
app.use(cors({
	origin: 'http://localhost:8080',
	credentials: true
}));
app.use(bodyParser.json());

// Authentication middleware
const ensureAuthenticated = (req, res, next) => {
	if (req.isAuthenticated()) {
		return next();
	}
	res.status(401).json({ error: 'Not authenticated' });
};

// Helper to get userId from request
const getUserId = (req) => {
	return req.user ? req.user.id : 'anonymous';
};

// Get default theme colors for a base theme
const getThemeDefaults = (baseTheme) => {
	const defaults = {
		sap_horizon: {
			brandColor: '#0070f2',
			focusColor: '#0032a5',
			shellColor: '#ffffff'
		},
		sap_fiori_3: {
			brandColor: '#0a6ed1',
			focusColor: '#000000',
			shellColor: '#354a5f'
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
};

// ========================================
// Authentication Routes
// ========================================

// GET /auth/login - Initiate OAuth login
app.get('/auth/login', (req, res, next) => {
	// Store the base URL in session for callback
	const baseUrl = getBaseUrl(req);
	req.session.callbackBaseUrl = baseUrl;

	// Override callbackURL dynamically
	const authenticateOptions = {
		callbackURL: `${baseUrl}/auth/callback`
	};

	passport.authenticate('oidc', authenticateOptions)(req, res, next);
});

// GET /auth/callback - OAuth callback
app.get('/auth/callback', (req, res, next) => {
	// Get base URL from session or construct from request
	const baseUrl = req.session.callbackBaseUrl || getBaseUrl(req);

	// Must use the same callbackURL as in /auth/login for token exchange
	const authenticateOptions = {
		callbackURL: `${baseUrl}/auth/callback`,
		failureRedirect: '/auth/login'
	};

	passport.authenticate('oidc', authenticateOptions, (err, user, info) => {
		if (err) {
			console.error('OAuth callback error:', err);
			return next(err);
		}
		if (!user) {
			console.error('OAuth callback: no user returned', info);
			return res.redirect('/auth/login');
		}

		req.logIn(user, (err) => {
			if (err) {
				console.error('Login error:', err);
				return next(err);
			}

			// Successful authentication, redirect to frontend
			res.redirect(`${baseUrl}/index.html`);
		});
	})(req, res, next);
});

// GET /auth/logout - Logout
app.get('/auth/logout', (req, res) => {
	const baseUrl = getBaseUrl(req);
	const postLogoutRedirectUri = `${baseUrl}/index.html`;

	// Build Keycloak logout URL with correct parameters
	// Use post_logout_redirect_uri (not redirect_uri) per OpenID Connect spec
	let keycloakLogoutUrl = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/logout`;
	keycloakLogoutUrl += `?post_logout_redirect_uri=${encodeURIComponent(postLogoutRedirectUri)}`;

	// Add id_token_hint if available (recommended for secure logout)
	if (req.user && req.user.idToken) {
		keycloakLogoutUrl += `&id_token_hint=${encodeURIComponent(req.user.idToken)}`;
	}

	req.logout((err) => {
		if (err) {
			return res.status(500).json({ error: 'Logout failed' });
		}
		req.session.destroy(() => {
			res.redirect(keycloakLogoutUrl);
		});
	});
});

// GET /api/user - Get current user info
app.get('/api/user', (req, res) => {
	if (req.isAuthenticated()) {
		res.json({
			authenticated: true,
			user: req.user
		});
	} else {
		res.json({
			authenticated: false
		});
	}
});

// ========================================
// Helper Functions
// ========================================
// (getThemeDefaults removed - now fetched from Theme Builder API)

// ========================================
// Theme Management API (CRUD)
// ========================================

// GET /api/available-versions - Get available UI5 versions from THEME_BUILDER_URLS
app.get('/api/available-versions', (req, res) => {
	try {
		const builderUrls = JSON.parse(process.env.THEME_BUILDER_URLS || '{}');
		const versions = Object.keys(builderUrls).map(version => ({
			key: version,
			text: `OpenUI5 ${version}`
		}));

		res.json({
			versions,
			defaultVersion: process.env.DEFAULT_UI5_VERSION || '1.96.40'
		});
	} catch (error) {
		console.error('[API] Error fetching available versions:', error);
		res.status(500).json({ error: 'Failed to fetch available versions', details: error.message });
	}
});

// GET /api/theme-defaults/:baseTheme - Get default colors for a base theme (proxied to Builder)
app.get('/api/theme-defaults/:baseTheme', async (req, res) => {
	try {
		const baseTheme = req.params.baseTheme;
		// Use default version for theme defaults
		const ui5Version = process.env.DEFAULT_UI5_VERSION || '1.96.40';

		const response = await builderRouter.proxyRequest(
			ui5Version,
			`/api/theme-defaults/${baseTheme}`,
			'GET'
		);

		res.status(response.status).json(response.data);
	} catch (error) {
		console.error('Error fetching theme defaults:', error);
		res.status(500).json({ error: 'Failed to fetch theme defaults', details: error.message });
	}
});

// GET /api/themes - Get all themes
app.get('/api/themes', ensureAuthenticated, async (req, res) => {
	try {
		const userId = getUserId(req);
		const themes = await statements.getAllThemes.all(userId);
		res.json(themes);
	} catch (error) {
		console.error('Error fetching themes:', error);
		res.status(500).json({ error: 'Failed to fetch themes', details: error.message });
	}
});

// GET /api/themes/:id - Get theme by ID
app.get('/api/themes/:id', ensureAuthenticated, async (req, res) => {
	try {
		const userId = getUserId(req);
		const theme = await statements.getThemeById.get(req.params.id, userId);
		if (!theme) {
			return res.status(404).json({ error: 'Theme not found' });
		}
		res.json(theme);
	} catch (error) {
		console.error('Error fetching theme:', error);
		res.status(500).json({ error: 'Failed to fetch theme', details: error.message });
	}
});

// POST /api/themes - Create new theme
app.post('/api/themes', ensureAuthenticated, async (req, res) => {
	try {
		const { themeId, name, baseTheme, brandColor, focusColor, shellColor, customCss, description, ui5Version } = req.body;
		const userId = getUserId(req);

		// Validate required fields
		if (!themeId || !name || !baseTheme) {
			return res.status(400).json({ error: 'Missing required fields: themeId, name, baseTheme' });
		}

		// Validate baseTheme
		const validBaseThemes = ['sap_horizon', 'sap_fiori_3', 'sap_fiori_3_dark', 'sap_fiori_3_hcb', 'sap_fiori_3_hcw'];
		if (!validBaseThemes.includes(baseTheme)) {
			return res.status(400).json({
				error: 'Invalid base theme',
				validThemes: validBaseThemes
			});
		}

		// Get base-theme-specific defaults
		const defaults = getThemeDefaults(baseTheme);

		// Use provided ui5Version or fall back to default
		const themeUi5Version = ui5Version || process.env.DEFAULT_UI5_VERSION || '1.96.40';

		const now = new Date().toISOString();
		const result = await statements.createTheme.run({
			themeId,
			name,
			baseTheme,
			brandColor: brandColor || defaults.brandColor,
			focusColor: focusColor || defaults.focusColor,
			shellColor: shellColor || defaults.shellColor,
			customCss: customCss || '',
			description: description || '',
			ui5Version: themeUi5Version,
			userId,
			createdAt: now,
			updatedAt: now
		});

		const newTheme = await statements.getThemeById.get(result.lastInsertRowid, userId);
		res.status(201).json(newTheme);
	} catch (error) {
		console.error('Error creating theme:', error);
		res.status(500).json({ error: 'Failed to create theme', details: error.message });
	}
});

// PUT /api/themes/:id - Update theme
app.put('/api/themes/:id', ensureAuthenticated, async (req, res) => {
	try {
		const { themeId, name, baseTheme, brandColor, focusColor, shellColor, customCss, description, ui5Version } = req.body;
		const id = req.params.id;
		const userId = getUserId(req);

		// Validate required fields
		if (!themeId || !name || !baseTheme || !brandColor || !focusColor) {
			return res.status(400).json({ error: 'Missing required fields: themeId, name, baseTheme, brandColor, focusColor' });
		}

		// Check if theme exists and belongs to user
		const existingTheme = await statements.getThemeById.get(id, userId);
		if (!existingTheme) {
			return res.status(404).json({ error: 'Theme not found' });
		}

		// Validate baseTheme
		const validBaseThemes = ['sap_horizon', 'sap_fiori_3', 'sap_fiori_3_dark', 'sap_fiori_3_hcb', 'sap_fiori_3_hcw'];
		if (!validBaseThemes.includes(baseTheme)) {
			return res.status(400).json({
				error: 'Invalid base theme',
				validThemes: validBaseThemes
			});
		}

		// Get base-theme-specific defaults
		const defaults = getThemeDefaults(baseTheme);

		// Use provided ui5Version or fall back to existing or default
		const themeUi5Version = ui5Version || existingTheme.ui5Version || process.env.DEFAULT_UI5_VERSION || '1.96.40';

		const now = new Date().toISOString();
		await statements.updateTheme.run({
			id: id,
			themeId,
			name,
			baseTheme,
			brandColor,
			focusColor,
			shellColor: shellColor || defaults.shellColor,
			customCss: customCss || '',
			description: description || '',
			ui5Version: themeUi5Version,
			userId,
			updatedAt: now
		});

		const updatedTheme = await statements.getThemeById.get(id, userId);
		res.json(updatedTheme);
	} catch (error) {
		console.error('Error updating theme:', error);
		res.status(500).json({ error: 'Failed to update theme', details: error.message });
	}
});

// DELETE /api/themes/:id - Delete theme
app.delete('/api/themes/:id', ensureAuthenticated, async (req, res) => {
	try {
		const themeId = req.params.id;
		const userId = getUserId(req);

		// Check if theme exists and belongs to user
		const existingTheme = await statements.getThemeById.get(themeId, userId);
		if (!existingTheme) {
			return res.status(404).json({ error: 'Theme not found' });
		}

		await statements.deleteTheme.run(themeId, userId);
		res.status(204).send();
	} catch (error) {
		console.error('Error deleting theme:', error);
		res.status(500).json({ error: 'Failed to delete theme', details: error.message });
	}
});

// POST /api/import-theme - Import theme from ZIP file
app.post('/api/import-theme', ensureAuthenticated, upload.single('themeZip'), async (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({ error: 'No file uploaded' });
		}

		console.log('Importing theme from ZIP:', req.file.originalname);

		// Get UI5 version from request body (sent via FormData)
		const ui5Version = req.body.ui5Version || '1.96.40';
		console.log('Import UI5 version:', ui5Version);

		// Parse ZIP from memory buffer
		const zip = new AdmZip(req.file.buffer);
		const zipEntries = zip.getEntries();

		// Find and parse exportThemesInfo.json
		const exportInfoEntry = zipEntries.find(entry => entry.entryName === 'exportThemesInfo.json');
		if (!exportInfoEntry) {
			return res.status(400).json({ error: 'Invalid theme ZIP: exportThemesInfo.json not found' });
		}

		const exportInfo = JSON.parse(exportInfoEntry.getData().toString('utf8'));
		const themesInfo = exportInfo.contentInfo.themes;
		const themeIds = Object.keys(themesInfo);

		if (themeIds.length === 0) {
			return res.status(400).json({ error: 'No themes found in exportThemesInfo.json' });
		}

		// Use first theme in the ZIP
		const themeId = themeIds[0];
		const themeInfo = themesInfo[themeId];
		let themeName = themeInfo.id;  // Technical name (directory name)
		let themeLabel = themeInfo.label || themeInfo.id;  // Display name
		const baseTheme = themeInfo.extends || 'sap_horizon';

		console.log(`Found theme: ${themeName} (${themeLabel}), base: ${baseTheme}`);

		// Find library-parameters.json from sap.ui.core to extract brand colors
		const coreParamsPath = `UI5/sap/ui/core/themes/${themeId}/library-parameters.json`;
		const coreParamsEntry = zipEntries.find(entry => entry.entryName === coreParamsPath);

		// Get base-theme-specific defaults
		const defaults = getThemeDefaults(baseTheme);
		let brandColor = defaults.brandColor;
		let focusColor = defaults.focusColor;
		let shellColor = defaults.shellColor;

		if (coreParamsEntry) {
			const coreParams = JSON.parse(coreParamsEntry.getData().toString('utf8'));

			// Extract brand color
			if (coreParams.sapBrandColor) {
				brandColor = coreParams.sapBrandColor;
			}

			// Extract focus color
			if (coreParams.sapContent_FocusColor) {
				focusColor = coreParams.sapContent_FocusColor;
			}

			// Extract shell color
			if (coreParams.sapShellColor) {
				shellColor = coreParams.sapShellColor;
			}

			console.log(`Extracted colors - Brand: ${brandColor}, Focus: ${focusColor}, Shell: ${shellColor}`);
		} else {
			console.warn('library-parameters.json not found, using default colors for base theme:', baseTheme);
		}

		// Extract custom CSS/LESS from custom.less file
		let customCss = '';
		const customLessPath = `UI5/sap/ui/core/themes/${themeId}/custom.less`;
		const customLessEntry = zipEntries.find(entry => entry.entryName === customLessPath);

		if (customLessEntry) {
			const customLessContent = customLessEntry.getData().toString('utf8');

			// Extract SAP_FREETEXT_LESS section (works for both SAP and our themes)
			const freetextMatch = customLessContent.match(/\/\*<SAP_FREETEXT_LESS>\*\/([\s\S]*?)\/\*<\/SAP_FREETEXT_LESS>\*\//);
			if (freetextMatch) {
				customCss = freetextMatch[1];
				console.log('Extracted custom CSS from SAP_FREETEXT_LESS section');
			}
		}

		if (customCss) {
			console.log(`Custom CSS extracted (${customCss.length} characters)`);
		} else {
			console.log('No custom CSS found in theme');
			customCss = '/* Imported theme */\n';
		}

		// Check if themeId already exists
		const existingTheme = await statements.getThemeByThemeId.get(themeName);
		if (existingTheme) {
			// Make unique by appending timestamp
			const timestamp = Date.now();
			themeName = `${themeName}_${timestamp}`;
			console.log(`Theme ID exists, using: ${themeName}`);
		}

		// Create theme in database
		const userId = getUserId(req);
		const now = new Date().toISOString();
		const result = await statements.createTheme.run({
			themeId: themeName,
			name: themeLabel,
			baseTheme: baseTheme,
			brandColor: brandColor,
			focusColor: focusColor,
			shellColor: shellColor,
			ui5Version: ui5Version,
			customCss: customCss,
			description: `Imported from ${req.file.originalname}`,
			userId,
			createdAt: now,
			updatedAt: now
		});

		const newTheme = await statements.getThemeById.get(result.lastInsertRowid, userId);
		console.log(`Theme imported successfully: ${themeName} (ID: ${newTheme.id})`);

		res.json(newTheme);
	} catch (error) {
		console.error('Error importing theme:', error);
		res.status(500).json({ error: 'Failed to import theme', details: error.message });
	}
});

// ========================================
// Theme Compilation API
// ========================================

// Preview theme endpoint (proxied to version-specific Builder API)
app.post('/api/preview-theme', ensureAuthenticated, async (req, res) => {
	try {
		const { ui5Version, baseTheme, brandColor, focusColor, shellColor, customCss } = req.body;

		console.log(`[Preview Proxy] UI5 ${ui5Version || 'default'}, Brand: ${brandColor}`);

		// Proxy request to appropriate Builder API
		const response = await builderRouter.proxyRequest(
			ui5Version,  // Router will use default if not provided
			'/api/preview-theme',
			'POST',
			{ baseTheme, brandColor, focusColor, shellColor, customCss }
		);

		// Forward response to client
		res.setHeader('Content-Type', response.headers['content-type'] || 'text/css');
		res.status(response.status).send(response.data);

	} catch (error) {
		console.error('[Preview Proxy] Error:', error);
		res.status(500).json({
			error: 'Failed to compile preview theme',
			details: error.message
		});
	}
});

// Theme compiler endpoint (proxied to version-specific Builder API)
app.post('/api/compile-theme', ensureAuthenticated, async (req, res) => {
	try {
		const { ui5Version, themeId, themeName, baseTheme, brandColor, focusColor, shellColor, customCss, description } = req.body;

		console.log(`[Compile Proxy] UI5 ${ui5Version}, Theme: ${themeId} (${themeName})`);

		// Proxy request to appropriate Builder API
		const response = await builderRouter.proxyRequest(
			ui5Version,
			'/api/compile-theme',
			'POST',
			{ themeId, themeName, baseTheme, brandColor, focusColor, shellColor, customCss, description }
		);

		// Forward ZIP response to client
		if (response.headers['content-type'] === 'application/zip') {
			res.setHeader('Content-Type', 'application/zip');
			res.setHeader('Content-Disposition', response.headers['content-disposition']);
			res.status(response.status).send(response.data);
		} else {
			// Error response (JSON)
			res.status(response.status).json(response.data);
		}

	} catch (error) {
		console.error('[Compile Proxy] Error:', error);
		res.status(500).json({
			error: 'Theme compilation failed',
			message: error.message
		});
	}
});

// Health check endpoint
app.get('/api/health', (req, res) => {
	res.json({ status: 'ok', message: 'Theme Designer API is running' });
});

initialize()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Theme Designer API running on port ${PORT}`);
            console.log(`Health check: http://localhost:${PORT}/api/health`);
        });
    })
    .catch((err) => {
        console.error('[DB] Initialization failed:', err);
        process.exit(1);
    });
