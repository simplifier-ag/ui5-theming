# Theme Builder API

Stateless OpenUI5 Theme Compilation Service - Version-specific LESS compiler.

## Architecture

This service is **stateless** - no sessions, no database, just LESS compilation:
- Receives theme parameters (colors, base theme, custom CSS) via API
- Compiles theme using `less-openui5`
- Returns compiled CSS or ZIP

## Supported UI5 Versions

- **1.96.40** (LTS)
- **1.120.0**

## Local Development

### 1. Setup for a specific UI5 version

```bash
# Setup for UI5 1.96.40 (default)
./setup.sh 1.96.40

# Or setup for UI5 1.120.0
./setup.sh 1.120.0
```

This will:
- Generate `package.json` from `package.template.json` with the specified version
- Install dependencies for that version
- Remove old `node_modules` if version changed

### 2. Start the server

```bash
npm start
```

Server runs on port 3001 (configurable via `PORT` env var).

### 3. Test the API

```bash
# Health check
curl http://localhost:3001/health

# Preview theme
curl -X POST http://localhost:3001/api/preview-theme \
  -H "Content-Type: application/json" \
  -d '{
    "baseTheme": "sap_horizon",
    "brandColor": "#ff6600",
    "focusColor": "#cc5200",
    "shellColor": "#ffffff",
    "customCss": ""
  }'
```

## API Endpoints

### `GET /health`
Health check endpoint.

**Response**: `{"status":"ok","ui5Version":"1.96.40"}`

---

### `POST /api/preview-theme`
Compile theme for preview (3 libraries: sap.ui.core, sap.m, sap.ui.layout).

**Request Body**:
```json
{
  "baseTheme": "sap_horizon",
  "brandColor": "#0070f2",
  "focusColor": "#0032a5",
  "shellColor": "#ffffff",
  "customCss": ""
}
```

**Response**: Compiled CSS (Content-Type: `text/css`)

---

### `POST /api/compile-theme`
Compile complete theme for export (16 libraries).

**Request Body**:
```json
{
  "themeId": "my_custom_theme",
  "themeName": "My Custom Theme",
  "baseTheme": "sap_horizon",
  "brandColor": "#0070f2",
  "focusColor": "#0032a5",
  "shellColor": "#ffffff",
  "customCss": "",
  "description": "Optional description"
}
```

**Response**: ZIP file (Content-Type: `application/zip`)

---

### `GET /api/theme-defaults/:baseTheme`
Get default colors for a base theme.

**Parameters**:
- `baseTheme`: `sap_horizon` or `sap_fiori_3`

**Response**:
```json
{
  "brandColor": "#0070f2",
  "focusColor": "#0032a5",
  "shellColor": "#ffffff"
}
```

## Docker Build

The Dockerfile uses a build argument to select the UI5 version:

```bash
# Build for UI5 1.96.40
docker build --build-arg UI5_VERSION=1.96.40 -t theme-builder-api:1.96.40 .

# Build for UI5 1.120.0
docker build --build-arg UI5_VERSION=1.120.0 -t theme-builder-api:1.120.0 .
```

## Environment Variables

- `PORT`: Server port (default: 3001)
- `UI5_VERSION`: UI5 version identifier (for logging)
- `NODE_ENV`: Node environment (development | production)

## Adding a New UI5 Version

1. Add the new version to the supported versions list in `setup.sh` (lines 18-20)
2. Test locally: `./setup.sh {version} && npm start`
3. Update docker-compose.yml to add new service
4. Update Azure Pipeline to build new image
5. Update Theme Designer App `THEME_BUILDER_URLS` environment variable

**Note**: No need to create separate package files - `package.json` is generated dynamically from `package.template.json`

## Files

- `server.js` - Express API server
- `theme-builder.js` - LESS compilation logic
- `package.template.json` - Template for version-specific dependencies
- `package.json` - Generated from template (not in git)
- `Dockerfile` - Multi-version Docker image
- `setup.sh` - Local development setup script
