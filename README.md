# OpenUI5 Theme Designer

A tool for creating, managing, and exporting custom OpenUI5 themes.

## Quick Start

```bash
npm install
npm run start:all
```

Opens http://localhost:8080 automatically.

## Features

- **Theme Management**: Create, edit, save, and delete multiple themes
- **Brand Color**: Set your company color as the primary brand color
- **Focus Color**: Color for focused UI elements (inputs, buttons, etc.)
- **Shell Color**: Color for the shell/header bar
- **Custom CSS**: Add custom LESS/CSS for advanced customizations
- **Image Upload**: Upload images (e.g. logos) and reference them in Custom CSS via `url('images/filename')`
- **Live Preview**: Preview changes in real-time using compiled LESS
- **Theme Export**: Export themes as ZIP files compatible with Simplifier and UI5 apps
- **Theme Import**: Import previously exported themes (SAP Theme Designer format)
- **OAuth Authentication**: Multi-user support with Keycloak/OIDC integration
- **Multiple UI5 Versions**: Export themes for UI5 1.96.40, 1.120.x, 1.136.x

## Architecture

The project consists of three types of components:

1. **Theme Designer App** (`theme-designer-app/`): OpenUI5 frontend + Express backend with OAuth, database, and routing. Exposed on port 8080.
2. **Theme Builder API** (`theme-builder-api/`): Stateless LESS compilation service. One instance per supported UI5 version. Only reachable internally.
3. **Database**: SQLite (default, no setup needed) or MySQL/MariaDB.

In Docker, the Designer App proxies all compile/preview requests to the appropriate Builder instance based on the selected UI5 version.

```
Browser → :8080 (theme-designer)
               ├── OAuth / Session
               ├── Theme CRUD (DB)
               ├── Image Upload (SHARED_DIR)
               └── Proxy → theme-builder-1-96:3000
                        → theme-builder-1-120:3000
                        → theme-builder-1-136:3000
```

## Installation

```bash
npm install
```

The `postinstall` script automatically installs server dependencies as well.

## Getting Started

### Start Everything

```bash
npm run start:all
```

Starts the backend API (port 3001) and UI5 app (port 8080) simultaneously.

### Start Components Individually

```bash
# Terminal 1 — Backend
npm run start:server

# Terminal 2 — UI5 App
npm run start:ui
```

## Docker Deployment

```bash
docker compose up -d
```

Only port 8080 is exposed. All internal services communicate over the Docker network.

**Volumes:**
- `db-data` (named volume) — SQLite database, only used when `DB_TYPE=sqlite`
- Bind mount for `SHARED_DIR` — uploaded files, shared between the designer and all builder instances

See `docker-compose.yml` for full configuration.

## Usage

1. **Sign In** (if OAuth is configured)
2. **Create Theme**: Click "New" on the overview, enter a name, technical ID, and base theme
3. **Customize**: Set brand color, focus color, shell color, and custom CSS
4. **Upload Images**: Upload logo or background images via the Images panel; reference them in Custom CSS with `url('images/filename')`
5. **Preview**: Changes are compiled live and shown in the preview iframe
6. **Save**: Saves all settings to the database
7. **Export**: Click "Export" to download a ZIP compatible with Simplifier/UI5

## Environment Variables

### OAuth / Authentication (Optional)

Without OAuth, all themes are created under the anonymous user.

```bash
KEYCLOAK_URL=https://your-keycloak-instance.com
KEYCLOAK_REALM=your-realm
CLIENT_ID=theme-designer
CLIENT_SECRET=your-client-secret
SESSION_SECRET=your-random-secret   # openssl rand -base64 32
```

### Database

SQLite is used by default — no configuration needed.

```bash
# SQLite (default)
DATABASE_DIR=/path/to/db-dir        # Where the .db file is stored (default: server/data/db)

# MySQL/MariaDB
DB_TYPE=mysql
DB_HOST=localhost
DB_PORT=3306
DB_NAME=themedesigner
DB_USER=themedesigner
DB_PASSWORD=your-password
DB_SSL=false
```

### File Storage

```bash
SHARED_DIR=/path/to/shared          # Uploaded images — must be the same path in Designer and all Builder instances
                                    # (default: server/data/shared)
```

### Theme Builder Routing

```bash
THEME_BUILDER_URLS='{"1.96.40":"http://theme-builder-1-96:3000","1.120.42":"http://theme-builder-1-120:3000"}'
DEFAULT_UI5_VERSION=1.96.40
```

### Other

```bash
PORT=3001                           # Designer backend port (default: 3001)
NODE_ENV=production                 # Use "development" for HTTP session cookies (local Docker)
```

## API (Designer App)

### Theme CRUD
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/themes` | List all themes |
| `GET` | `/api/themes/:id` | Get single theme |
| `POST` | `/api/themes` | Create theme |
| `PUT` | `/api/themes/:id` | Update theme |
| `DELETE` | `/api/themes/:id` | Delete theme |

### Images
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/themes/:id/images` | List uploaded images |
| `POST` | `/api/themes/:id/images` | Upload image |
| `DELETE` | `/api/themes/:id/images/:imageId` | Delete image |

### Preview (proxied to Builder)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/preview-compile` | Compile theme, return cache key |
| `GET` | `/api/preview-page?key=...` | Serve preview HTML page |
| `GET` | `/api/preview-resources/:key/*` | Serve compiled CSS / fonts / JSON |

### Export / Import
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/compile-theme` | Compile and download theme ZIP |
| `POST` | `/api/import-theme` | Import theme from ZIP |

### Other
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/available-versions` | List supported UI5 versions |
| `GET` | `/api/theme-defaults/:baseTheme` | Default colors for a base theme |
| `GET` | `/api/user` | Current user info |
| `GET` | `/api/health` | Health check |

## Exported Theme Structure

```
my_theme.zip
├── README.md
├── exportThemesInfo.json
└── UI5/
    └── sap/
        ├── ui/core/themes/my_theme/
        │   ├── library.css
        │   ├── library-RTL.css
        │   ├── library-parameters.json
        │   ├── .theming
        │   └── fonts/              ← SAP-icons, 72-*
        ├── m/themes/my_theme/
        │   ├── library.css
        │   ├── library-RTL.css
        │   ├── library-parameters.json
        │   └── .theming
        └── ...                     ← 16 libraries total
```

## Theme Installation in a UI5 App

```html
<script id="sap-ui-bootstrap"
    src="resources/sap-ui-core.js"
    data-sap-ui-theme="my_theme@themes/my_theme"
    ...>
</script>
```

## Database Migrations

```bash
cd theme-designer-app/server

npm run db:migrate    # Run pending migrations
npm run db:rollback   # Rollback last migration
npm run db:status     # Show migration status
```

## Build

```bash
# Standard build
npm run build

# Optimized self-contained build (for Docker / production)
npm run build:opt
```

Output goes to `dist/`. Start the built app:

```bash
npm run start:dist
```

## Technology Stack

- **Frontend**: OpenUI5 1.96.40 (JavaScript, XML Views)
- **Backend**: Node.js, Express
- **Authentication**: Passport.js + OpenID Connect (Keycloak)
- **Database**: Knex.js + SQLite (default) or MySQL/MariaDB
- **Theme Compiler**: less-openui5
- **Preview**: Mustache-rendered HTML, CSS served via cache key
- **Containerization**: Docker, nginx (frontend + proxy), multi-container via docker-compose

## License

Apache Software License, Version 2.0 — see [LICENSE](LICENSE).
