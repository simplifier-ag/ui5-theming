/**
 * Builder Registry
 *
 * Theme Builder API instances (theme-builder-api) connect to us via socket.io and
 * register themselves with their UI5 version, their own reachable base URL, and
 * the base themes they support. We keep an in-memory registry and proxy HTTP
 * requests to whichever builder is currently registered for a given UI5 version.
 *
 * This replaces the old static THEME_BUILDER_URLS env-var configuration: builders
 * find us (via DESIGNER_URL configured on the builder side), not the other way
 * around. Two important consequences:
 *
 * - The designer can be restarted without restarting any builder: socket.io's
 *   client automatically reconnects (with backoff) and re-sends its registration
 *   as soon as we come back up.
 * - We find out immediately when a builder disconnects or crashes, via socket.io's
 *   disconnect event (which fires on a clean close as well as on a missed
 *   heartbeat/ping-timeout for a dead connection).
 *
 * Environment Variables:
 * - DEFAULT_UI5_VERSION: preferred default version (default: none — falls back to
 *   whichever version happens to be registered first if unset or not connected)
 *
 * Usage:
 *   const BuilderRegistry = require('./builder-registry');
 *   const registry = new BuilderRegistry();
 *   registry.attach(httpServer); // after app.listen()
 *   const response = await registry.proxyRequest('1.96.40', '/api/preview-compile', 'POST', body);
 */

const fetch = require('node-fetch');
const { Server } = require('socket.io');

// Small display-label helper for base theme ids reported by builders, e.g.
// "sap_horizon_dark" -> "SAP Horizon Dark", "sap_fiori_3_hcb" -> "SAP Fiori 3 HCB".
const LABEL_OVERRIDES = { sap: 'SAP', hcb: 'HCB', hcw: 'HCW' };

function prettifyBaseThemeLabel(id) {
	return id
		.split('_')
		.map(part => LABEL_OVERRIDES[part.toLowerCase()] || (part.charAt(0).toUpperCase() + part.slice(1)))
		.join(' ');
}

class BuilderRegistry {
	constructor() {
		// ui5Version -> { socket, selfUrl, baseThemes, registeredAt }
		this.builders = new Map();
		this.preferredDefaultVersion = process.env.DEFAULT_UI5_VERSION || '';

		console.log('='.repeat(60));
		console.log('Builder Registry');
		console.log('='.repeat(60));
		console.log('Preferred default UI5 version:', this.preferredDefaultVersion || '(none configured — first registered wins)');
		console.log('Waiting for builders to self-register via socket.io...');
		console.log('='.repeat(60));
	}

	/**
	 * Attach the socket.io server to an existing http.Server instance.
	 * Must be called once, after app.listen().
	 */
	attach(httpServer) {
		this.io = new Server(httpServer, {
			// Builders are trusted Node-to-Node clients on the internal Docker network
			// (never a browser) — CORS enforcement is irrelevant for this connection.
			cors: { origin: '*' }
		});

		this.io.on('connection', (socket) => {
			console.log(`[BuilderRegistry] Socket connected: ${socket.id}`);

			socket.on('register', (payload) => this._handleRegister(socket, payload));
			socket.on('disconnect', (reason) => this._handleDisconnect(socket, reason));
		});
	}

	_handleRegister(socket, payload) {
		const { ui5Version, selfUrl, baseThemes } = payload || {};

		if (!ui5Version || !selfUrl) {
			console.warn(`[BuilderRegistry] Ignoring invalid registration from ${socket.id}:`, payload);
			return;
		}

		const existing = this.builders.get(ui5Version);
		if (existing && existing.socket !== socket) {
			console.warn(`[BuilderRegistry] Replacing existing builder for UI5 ${ui5Version} (was ${existing.selfUrl}, now ${selfUrl})`);
		}

		// Tag the socket with its version so disconnect cleanup knows what to remove.
		socket.ui5Version = ui5Version;

		this.builders.set(ui5Version, {
			socket,
			selfUrl,
			baseThemes: Array.isArray(baseThemes) ? baseThemes : [],
			registeredAt: new Date().toISOString()
		});

		console.log(`[BuilderRegistry] Registered builder for UI5 ${ui5Version} → ${selfUrl} (base themes: ${(baseThemes || []).join(', ') || 'none'})`);

		socket.emit('registered', { ui5Version });
	}

	_handleDisconnect(socket, reason) {
		const version = socket.ui5Version;
		if (!version) return; // disconnected before ever registering

		const entry = this.builders.get(version);
		// Only remove if this disconnecting socket is still the active entry for that
		// version — avoids a stale disconnect event from a superseded connection
		// wiping out a newer, still-alive registration.
		if (entry && entry.socket === socket) {
			this.builders.delete(version);
			console.log(`[BuilderRegistry] Builder for UI5 ${version} disconnected (${reason}) — removed from registry`);
		}
	}

	/** Base URL of the currently registered builder for a UI5 version, if any. */
	getBuilderUrl(ui5Version) {
		const version = ui5Version || this.getDefaultVersion();
		const entry = this.builders.get(version);
		return entry ? entry.selfUrl : undefined;
	}

	/** All currently connected UI5 versions. */
	getAvailableVersions() {
		return Array.from(this.builders.keys());
	}

	/** Versions + their supported base themes (with display labels), for the frontend. */
	getAvailableVersionsWithBaseThemes() {
		return this.getAvailableVersions().sort().map(version => {
			const entry = this.builders.get(version);
			return {
				key: version,
				text: `OpenUI5 ${version}`,
				baseThemes: entry.baseThemes.map(id => ({ key: id, text: prettifyBaseThemeLabel(id) }))
			};
		});
	}

	isVersionSupported(ui5Version) {
		return this.builders.has(ui5Version);
	}

	/**
	 * The version to fall back to when none is explicitly requested: the
	 * configured DEFAULT_UI5_VERSION if it's currently registered, otherwise the
	 * first (alphabetically sorted) connected version, otherwise ''.
	 */
	getDefaultVersion() {
		const versions = this.getAvailableVersions().sort();
		if (versions.length === 0) return this.preferredDefaultVersion || '';
		if (this.preferredDefaultVersion && versions.includes(this.preferredDefaultVersion)) {
			return this.preferredDefaultVersion;
		}
		return versions[0];
	}

	/**
	 * Proxy a request to the appropriate Theme Builder API.
	 * @param {string} ui5Version - UI5 version (e.g., "1.96.40"); falls back to getDefaultVersion() if falsy
	 * @param {string} endpoint - API endpoint path (e.g., "/api/preview-compile")
	 * @param {string} method - HTTP method (GET, POST, etc.)
	 * @param {object} body - Request body (will be JSON.stringify'd)
	 * @param {object} headers - Additional headers
	 * @returns {Promise<{status: number, data: any, headers: object}>}
	 */
	async proxyRequest(ui5Version, endpoint, method = 'GET', body = null, headers = {}) {
		const version = ui5Version || this.getDefaultVersion();
		const builderUrl = this.getBuilderUrl(version);

		if (!builderUrl) {
			const err = new Error(`No builder currently connected for UI5 version ${version || '(none)'}`);
			err.statusCode = 503;
			throw err;
		}

		const fullUrl = `${builderUrl}${endpoint}`;
		console.log(`[BuilderRegistry] ${method} ${fullUrl} (UI5 ${version})`);

		try {
			const options = {
				method,
				headers: {
					'Content-Type': 'application/json',
					...headers
				}
			};

			if (body && method !== 'GET') {
				options.body = JSON.stringify(body);
			}

			const response = await fetch(fullUrl, options);

			// Handle different content types
			const contentType = response.headers.get('content-type');
			let data;

			if (contentType && contentType.includes('application/json')) {
				data = await response.json();
			} else if (contentType && contentType.includes('text/')) {
				data = await response.text();
			} else {
				// Binary data (e.g., ZIP files)
				data = await response.buffer();
			}

			return {
				status: response.status,
				data: data,
				headers: {
					'content-type': response.headers.get('content-type'),
					'content-disposition': response.headers.get('content-disposition')
				}
			};

		} catch (error) {
			console.error(`[BuilderRegistry] Error proxying request to ${fullUrl}:`, error);
			throw error;
		}
	}
}

module.exports = BuilderRegistry;
