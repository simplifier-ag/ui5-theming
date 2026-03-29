# Theme Builder API

Stateless OpenUI5 theme compilation service. Receives theme parameters, compiles LESS, and returns CSS or a ZIP file. No database, no sessions.

## Supported UI5 Versions

- **1.96.40** (LTS)
- **1.120.42**
- **1.136.13**

## Local Development

### 1. Setup for a specific UI5 version

```bash
# UI5 1.96.40 (default)
./setup.sh 1.96.40

# UI5 1.120.42
./setup.sh 1.120.42
```

This generates `package.json` from `package.template.json` for the specified version and installs dependencies.

### 2. Start the server

```bash
npm start
```

Runs on port 3001 by default (configurable via `PORT`).

### 3. Test

```bash
# Health check
curl http://localhost:3001/health

# Compile preview
curl -X POST http://localhost:3001/api/preview-compile \
  -H "Content-Type: application/json" \
  -d '{
    "baseTheme": "sap_horizon",
    "brandColor": "#ff6600",
    "focusColor": "#cc5200",
    "shellColor": "#ffffff",
    "customCss": "",
    "themeId": "1"
  }'
# → { "key": "abc123..." }

# Download compiled CSS for a library
curl "http://localhost:3001/api/preview-resources/abc123.../sap/ui/core/themes/my_theme/library.css"
```

## API Endpoints

### `GET /health`

```json
{ "status": "ok", "ui5Version": "1.96.40" }
```

---

### `POST /api/preview-compile`

Compiles theme for all 16 libraries, caches result (30 min TTL, keyed by SHA256 of parameters).

**Request Body:**
```json
{
  "baseTheme": "sap_horizon",
  "brandColor": "#0070f2",
  "focusColor": "#0032a5",
  "shellColor": "#ffffff",
  "customCss": "",
  "themeId": "42"
}
```

**Response:**
```json
{ "key": "abc123def456" }
```

---

### `GET /api/preview-page?key=<key>`

Returns the full preview HTML page for loading in an iframe. Requires a key from `preview-compile`.

---

### `GET /api/preview-resources/:cacheKey/*`

Serves compiled CSS, `library-parameters.json`, and font files for the preview iframe.

Examples:
- `GET /api/preview-resources/abc123.../sap/ui/core/themes/my_theme/library.css`
- `GET /api/preview-resources/abc123.../sap/ui/core/themes/my_theme/library-parameters.json`
- `GET /api/preview-resources/abc123.../sap/ui/core/themes/my_theme/fonts/SAP-icons.woff2`

---

### `POST /api/compile-theme`

Compiles the complete theme (16 libraries) and returns a ZIP file.

**Request Body:**
```json
{
  "themeId": "my_custom_theme",
  "themeName": "My Custom Theme",
  "baseTheme": "sap_horizon",
  "brandColor": "#0070f2",
  "focusColor": "#0032a5",
  "shellColor": "#ffffff",
  "customCss": "",
  "description": "Optional description",
  "dbThemeId": "42"
}
```

**Response:** ZIP file (`application/zip`)

---

### `GET /api/theme-defaults/:baseTheme`

Returns default colors for a base theme.

```json
{
  "brandColor": "#0070f2",
  "focusColor": "#0032a5",
  "shellColor": "#ffffff"
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `UI5_VERSION` | — | UI5 version identifier (for logging) |
| `NODE_ENV` | `development` | Node environment |
| `SHARED_DIR` | `../theme-designer-app/server/data/shared` | Path to uploaded files (images); must match the Designer's `SHARED_DIR` |

## Docker Build

```bash
# UI5 1.96.40
docker build --build-arg UI5_VERSION=1.96.40 -t theme-builder-api:1.96.40 .

# UI5 1.120.42
docker build --build-arg UI5_VERSION=1.120.42 -t theme-builder-api:1.120.42 .
```

In `docker-compose.yml`, each version runs as a separate service (`theme-builder-1-96`, `theme-builder-1-120`, `theme-builder-1-136`) on port 3000 internally. The Designer App routes to the correct instance based on the selected UI5 version.

## Adding a New UI5 Version

1. Add the version to `setup.sh`
2. Test locally: `./setup.sh {version} && npm start`
3. Add a new service to `docker-compose.yml`
4. Add a new builder image to the Azure Pipeline
5. Update `THEME_BUILDER_URLS` in the Designer App config

## Files

| File | Description |
|------|-------------|
| `server.js` | Express API server |
| `theme-builder.js` | LESS compilation logic (`buildTheme`, `compilePreviewLibraries`, `buildLibrary`) |
| `package.template.json` | Template for version-specific `package.json` |
| `package.json` | Generated from template (not in git) |
| `Dockerfile` | Multi-version Docker image |
| `setup.sh` | Local development setup script |
| `preview/index.html.mustache` | Preview page template |
| `preview/Preview.view.xml` | UI5 XML view rendered in preview iframe |
