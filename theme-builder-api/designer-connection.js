/**
 * Designer Connection
 *
 * Connects this Builder instance to the Theme Designer as a socket.io client and
 * registers it with its UI5 version, its own reachable base URL, and the base
 * themes it supports. socket.io-client handles reconnection (with backoff)
 * automatically — if the Designer restarts, we simply reconnect and re-register
 * as soon as it's back, without needing to restart this process.
 *
 * Environment Variables (read by server.js, passed in here as options):
 * - DESIGNER_URL: base URL of the Theme Designer's API server, e.g.
 *   http://theme-designer:3000 (the internal port — no reverse proxy involved,
 *   since Builder and Designer sit on the same Docker network)
 * - SELF_URL: base URL at which THIS builder instance is reachable by the
 *   Designer for HTTP calls, e.g. http://theme-builder-1-96:3000
 *
 * If DESIGNER_URL is not set, self-registration is skipped entirely — useful for
 * standalone/local use of the builder (e.g. via test-builder.js) without a
 * running Designer.
 */

const { io } = require('socket.io-client');

function connectToDesigner({ designerUrl, selfUrl, ui5Version, baseThemes }) {
	if (!designerUrl) {
		console.log('[DesignerConnection] DESIGNER_URL not set — skipping self-registration with a Designer');
		return null;
	}
	if (!selfUrl) {
		console.warn('[DesignerConnection] SELF_URL not set — cannot self-register without it, skipping');
		return null;
	}

	console.log(`[DesignerConnection] Connecting to Designer at ${designerUrl}...`);

	const socket = io(designerUrl, {
		reconnection: true,
		reconnectionDelay: 1000,
		reconnectionDelayMax: 30000,
		randomizationFactor: 0.5
	});

	// Fires on the initial connect AND on every automatic reconnect — re-sending
	// the registration each time is exactly what we want (e.g. after a Designer
	// restart wiped its in-memory registry).
	socket.on('connect', () => {
		console.log(`[DesignerConnection] Connected (socket ${socket.id}) — registering as UI5 ${ui5Version} (${selfUrl})`);
		socket.emit('register', { ui5Version, selfUrl, baseThemes, startedAt: new Date().toISOString() });
	});

	socket.on('registered', (payload) => {
		console.log(`[DesignerConnection] Registration confirmed for UI5 ${payload.ui5Version}`);
	});

	socket.on('disconnect', (reason) => {
		console.warn(`[DesignerConnection] Disconnected from Designer (${reason}) — will reconnect automatically`);
	});

	socket.on('connect_error', (err) => {
		console.warn(`[DesignerConnection] Connection error: ${err.message}`);
	});

	return socket;
}

module.exports = { connectToDesigner };
