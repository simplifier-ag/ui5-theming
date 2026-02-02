/**
 * Theme Builder Router
 *
 * Routes API requests to the appropriate Theme Builder API instance based on UI5 version.
 *
 * Environment Variables:
 * - THEME_BUILDER_URLS: JSON object mapping UI5 version to Builder API URL
 *   Example: {"1.96.40":"http://theme-builder-1-96:3001","1.120.0":"http://theme-builder-1-120:3001"}
 * - DEFAULT_UI5_VERSION: Fallback version if theme has no ui5Version (default: "1.96.40")
 *
 * Usage:
 *   const BuilderRouter = require('./router');
 *   const router = new BuilderRouter();
 *   const response = await router.proxyRequest('1.96.40', '/api/preview-theme', 'POST', requestBody);
 */

const fetch = require('node-fetch');

class BuilderRouter {
	constructor() {
		// Parse THEME_BUILDER_URLS from environment
		const urlsEnv = process.env.THEME_BUILDER_URLS || '{}';
		try {
			this.builderUrls = JSON.parse(urlsEnv);
		} catch (error) {
			console.error('Failed to parse THEME_BUILDER_URLS:', error);
			this.builderUrls = {};
		}

		// Set default version
		this.defaultVersion = process.env.DEFAULT_UI5_VERSION || '1.96.40';

		// Log configuration
		console.log('='.repeat(60));
		console.log('Theme Builder Router Configuration');
		console.log('='.repeat(60));
		console.log('Default UI5 Version:', this.defaultVersion);
		console.log('Configured Builder URLs:');
		Object.entries(this.builderUrls).forEach(([version, url]) => {
			console.log(`  ${version} → ${url}`);
		});
		console.log('='.repeat(60));
	}

	/**
	 * Get the Builder API URL for a specific UI5 version
	 * @param {string} ui5Version - UI5 version (e.g., "1.96.40", "1.120.0")
	 * @returns {string} - Builder API URL
	 */
	getBuilderUrl(ui5Version) {
		const version = ui5Version || this.defaultVersion;
		const url = this.builderUrls[version];

		if (!url) {
			console.warn(`No Builder URL configured for UI5 version ${version}, using default: ${this.defaultVersion}`);
			return this.builderUrls[this.defaultVersion];
		}

		return url;
	}

	/**
	 * Proxy a request to the appropriate Theme Builder API
	 * @param {string} ui5Version - UI5 version (e.g., "1.96.40")
	 * @param {string} endpoint - API endpoint path (e.g., "/api/preview-theme")
	 * @param {string} method - HTTP method (GET, POST, etc.)
	 * @param {object} body - Request body (will be JSON.stringify'd)
	 * @param {object} headers - Additional headers
	 * @returns {Promise<{status: number, data: any, headers: object}>}
	 */
	async proxyRequest(ui5Version, endpoint, method = 'GET', body = null, headers = {}) {
		const builderUrl = this.getBuilderUrl(ui5Version);
		const fullUrl = `${builderUrl}${endpoint}`;

		console.log(`[Router] ${method} ${fullUrl} (UI5 ${ui5Version})`);

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
			console.error(`[Router] Error proxying request to ${fullUrl}:`, error);
			throw error;
		}
	}

	/**
	 * Get available UI5 versions
	 * @returns {string[]} - Array of UI5 versions
	 */
	getAvailableVersions() {
		return Object.keys(this.builderUrls);
	}

	/**
	 * Check if a UI5 version is supported
	 * @param {string} ui5Version - UI5 version to check
	 * @returns {boolean}
	 */
	isVersionSupported(ui5Version) {
		return this.builderUrls.hasOwnProperty(ui5Version);
	}
}

module.exports = BuilderRouter;
