# OpenUI5 Theme Designer

A tool for creating and exporting custom OpenUI5 themes for version 1.96.40.

## 🚀 Quick Start

```bash
npm install
npm run start:all
```

Automatically opens http://localhost:8080/index.html - done! 🎉

## Features

- **Brand Color Customization**: Set your company color as the brand color
- **Focus Color**: Color for focused elements (buttons, inputs, etc.)
- **Shell Color**: Color for the shell/header bar (theme-specific default)
- **Custom CSS**: Add custom CSS for advanced customizations
- **Live Preview**: Preview changes directly in the application
- **Theme Management**: Save, edit, and manage multiple themes
- **OAuth Authentication**: Multi-user support with Keycloak integration
- **Theme Export**: Export themes as ZIP files for use in your UI5 apps
- **Theme Import**: Import previously exported themes

## Architecture

The project consists of two components:

1. **Frontend (OpenUI5 App)**: UI5 1.96.40 application on port 8080
2. **Backend (Node.js Server)**: Theme compiler API on port 3001

**Docker:** Multi-container setup with Theme Designer App and separate Theme Builder Service available.

## Description

This tool enables creating custom OpenUI5 themes without manually editing LESS files. Brand colors and other design parameters can be customized through a user-friendly interface.

## Requirements

- [Node.js](https://nodejs.org/) (v14 or higher)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/) for dependency management

## Installation

A single command installs everything (UI5 App + Backend Server):
```bash
npm install
```

The `postinstall` script automatically installs server dependencies as well.

## Getting Started

### Recommended - Start Everything with One Command:

```bash
npm run start:all
```

This command automatically starts:
- Backend API server on port 3001
- OpenUI5 app on port 8080

The app opens automatically in your browser at http://localhost:8080/index.html

### Alternative - Start Components Individually:

**Option 1 - Shell Script (Unix/Mac):**
```bash
./start-all.sh
```

**Option 2 - Manual in Separate Terminals:**

Terminal 1 - Backend Server:
```bash
npm run start:server
```

Terminal 2 - UI5 App:
```bash
npm run start:ui
```

**Option 3 - Windows:**
```bash
start-all.bat
```

## Docker Deployment

For production deployments with Docker:

```bash
docker pull <your-org>/theme-designer:latest
docker run -d -p 8080:8080 <your-org>/theme-designer:latest
```

The app is then accessible at http://localhost:8080

**Environment Variables:** See `.env.example` for OAuth configuration and other options.

## Usage

1. **Sign In** (optional): Sign in with Keycloak if OAuth is enabled
2. **Create Theme**: Create a new theme in the theme overview
3. **Select Base Theme**: Choose the base theme (sap_horizon, sap_fiori_3)
4. **Set Brand Color**: Enter your main color (HEX format: #007bff)
5. **Adjust Focus Color**: Automatically calculated, can be overridden
6. **Set Shell Color**: Color for header/shell (default depends on base theme)
7. **Add Custom CSS**: Optional for advanced customizations
8. **Live Preview**: Changes are automatically displayed in the preview
9. **Save Theme**: Theme is saved to database
10. **Export Theme**: Click "Export Theme" to get a ZIP file

## Theme Installation

After export:

1. Extract the ZIP file
2. Copy the theme folder to your UI5 app (e.g., to `webapp/themes/`)
3. Activate the theme in your `index.html`:

```html
<script id="sap-ui-bootstrap"
    src="resources/sap-ui-core.js"
    data-sap-ui-theme="my_custom_theme@themes/my_custom_theme"
    ...>
</script>
```

## Backend API

### POST /api/compile-theme

Compiles a theme based on the specified parameters.

**Request Body:**
```json
{
  "themeName": "my_custom_theme",
  "baseTheme": "sap_horizon",
  "brandColor": "#007bff",
  "focusColor": "#0056b3",
  "shellColor": "#354a5f",
  "customCss": "/* custom css */"
}
```

**Response**: ZIP file with the compiled theme

### POST /api/preview-theme

Compiles theme CSS for live preview (only 3 libraries, faster).

**Request Body:**
```json
{
  "baseTheme": "sap_horizon",
  "brandColor": "#007bff",
  "focusColor": "#0056b3",
  "shellColor": "#354a5f",
  "customCss": "/* custom css */"
}
```

**Response**: Compiled CSS as text/css

### GET /api/health

Health check endpoint

## Technology Stack

- **Frontend**: OpenUI5 1.96.40 (JavaScript)
- **Backend**: Node.js, Express
- **Authentication**: Passport.js with OAuth 2.0 / OpenID Connect (Keycloak)
- **Database**: better-sqlite3 (SQLite)
- **Theme Compiler**: less-openui5
- **Additional Packages**: archiver, cors, body-parser, concurrently, express-session

## Environment Variables

### OAuth Authentication (Optional)

If OAuth/OIDC authentication should be used:

```bash
KEYCLOAK_URL=https://your-keycloak-instance.com
KEYCLOAK_REALM=your-realm
KEYCLOAK_CLIENT_ID=theme-designer
KEYCLOAK_CLIENT_SECRET=your-client-secret
SESSION_SECRET=your-random-secret  # Generate: openssl rand -base64 32
```

### Additional (Optional)

```bash
PORT=3001                    # API server port (default: 3001)
NODE_ENV=production          # Node environment (default: development)
```

**Note**: Without OAuth, themes can be created locally (User: 'anonymous').

## Available npm Scripts

| Script | Description |
|--------|-------------|
| `npm install` | Installs all dependencies (UI5 + Server) |
| `npm run start:all` | ⭐ Starts backend + frontend simultaneously |
| `npm run start:ui` | Starts only the UI5 app (port 8080) |
| `npm run start:server` | Starts only the backend server (port 3001) |
| `npm start` | Alias for `start:ui` |
| `npm run build` | Builds the UI5 app |
| `npm run lint` | Linter for code quality |
| `npm test` | Runs tests |

## Structure of Exported Theme

```
my_custom_theme.zip
├── README.md
└── my_custom_theme/
    ├── library.css          # Compiled CSS
    ├── library-RTL.css      # Right-to-Left CSS
    ├── library-parameters.json  # Theme Parameters
    └── .theming             # Theme Metadata
```

## Build the App

### Unoptimized (but quick)

Execute the following command to build the project and get an app that can be deployed:

```sh
npm run build
```

The result is placed into the `dist` folder. To start the generated package, just run

```sh
npm run start:dist
```

Note that `index.html` still loads the UI5 framework from the relative URL `resources/...`, which does not physically exist, but is only provided dynamically by the UI5 tooling. So for an actual deployment you should change this URL to either [the CDN](https://sdk.openui5.org/#/topic/2d3eb2f322ea4a82983c1c62a33ec4ae) or your local deployment of UI5.

(When using yarn, do `yarn build` and `yarn start:dist` instead.)

### Optimized

For an optimized self-contained build (takes longer because the UI5 resources are built, too), do:

```sh
npm run build:opt
```

To start the generated package, again just run:

```sh
npm run start:dist
```

In this case, all UI5 framework resources are also available within the `dist` folder, so the folder can be deployed as-is to any static web server, without changing the bootstrap URL.

With the self-contained build, the bootstrap URL in `index.html` has already been modified to load the newly created `sap-ui-custom.js` for bootstrapping, which contains all app resources as well as all needed UI5 JavaScript resources. Most UI5 resources inside the `dist` folder are for this reason actually **not** needed to run the app. Only the non-JS-files, like translation texts and CSS files, are used and must also be deployed. (Only when for some reason JS files are missing from the optimized self-contained bundle, they are also loaded separately.)

(When using yarn, do `yarn build:opt` and `yarn start:dist` instead.)

## Check the Code

To lint the code, do:

```sh
npm run lint
```

(Again, when using yarn, do `yarn lint` instead.)

## License

This project is licensed under the Apache Software License, version 2.0 except as noted otherwise in the [LICENSE](LICENSE) file.