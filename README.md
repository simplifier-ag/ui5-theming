# OpenUI5 Theme Designer

Ein Tool zum Erstellen und Exportieren von benutzerdefinierten OpenUI5 Themes für Version 1.96.40.

## 🚀 Quick Start

```bash
npm install
npm run start:all
```

Öffnet automatisch http://localhost:8080/index.html - fertig! 🎉

## Features

- **Brand Color Anpassung**: Setze deine Unternehmensfarbe als Brand Color
- **Focus Color**: Farbe für fokussierte Elemente (Buttons, Inputs, etc.)
- **Shell Color**: Farbe für die Shell/Header-Bar (Theme-spezifischer Default)
- **Custom CSS**: Füge beliebiges CSS hinzu für erweiterte Anpassungen
- **Live Preview**: Vorschau der Änderungen direkt in der Anwendung
- **Theme Management**: Speichere, bearbeite und verwalte mehrere Themes
- **OAuth Authentication**: Multi-User Support mit Keycloak Integration
- **Theme Export**: Exportiere das Theme als ZIP-Datei für die Verwendung in deinen UI5 Apps
- **Theme Import**: Importiere bereits exportierte Themes

## Architektur

Das Projekt besteht aus zwei Komponenten:

1. **Frontend (OpenUI5 App)**: UI5 1.96.40 Anwendung auf Port 8080
2. **Backend (Node.js Server)**: Theme-Compiler-API auf Port 3001

**Docker:** Multi-Container Setup mit Theme Designer App und separatem Theme Builder Service verfügbar.

## Description

Dieses Tool ermöglicht es, benutzerdefinierte OpenUI5 Themes zu erstellen, ohne manuell LESS-Dateien bearbeiten zu müssen. Die Brand Color und andere Designparameter können über eine benutzerfreundliche Oberfläche angepasst werden.

## Requirements

- [Node.js](https://nodejs.org/) (v14 or higher)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/) for dependency management

## Installation

Ein einziger Befehl installiert alles (UI5 App + Backend Server):
```bash
npm install
```

Das `postinstall` Script installiert automatisch auch die Server-Dependencies.

## Starten

### Empfohlen - Alles mit einem Befehl:

```bash
npm run start:all
```

Dieser Befehl startet automatisch:
- Backend API Server auf Port 3001
- OpenUI5 App auf Port 8080

Die App öffnet sich automatisch im Browser unter http://localhost:8080/index.html

### Alternative - Einzeln starten:

**Option 1 - Shell Script (Unix/Mac):**
```bash
./start-all.sh
```

**Option 2 - Manuell in separaten Terminals:**

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

Für Production-Deployments mit Docker:

```bash
docker pull <your-org>/theme-designer:latest
docker run -d -p 8080:8080 <your-org>/theme-designer:latest
```

Die App ist dann erreichbar unter http://localhost:8080

**Environment Variables:** Siehe `.env.example` für OAuth-Konfiguration und weitere Optionen.

## Verwendung

1. **Anmelden** (optional): Bei aktiviertem OAuth mit Keycloak anmelden
2. **Theme erstellen**: Neues Theme in der Theme-Übersicht anlegen
3. **Base Theme wählen**: Wähle das Basis-Theme aus (sap_horizon, sap_fiori_3)
4. **Brand Color setzen**: Gib deine Hauptfarbe ein (HEX-Format: #007bff)
5. **Focus Color anpassen**: Wird automatisch berechnet, kann aber überschrieben werden
6. **Shell Color setzen**: Farbe für Header/Shell (Default abhängig vom Base Theme)
7. **Custom CSS hinzufügen**: Optional für erweiterte Anpassungen
8. **Live Preview**: Änderungen werden automatisch in der Preview angezeigt
9. **Theme speichern**: Theme wird in Datenbank gespeichert
10. **Theme exportieren**: Klicke auf "Export Theme" um eine ZIP-Datei zu erhalten

## Theme Installation

Nach dem Export:

1. Entpacke die ZIP-Datei
2. Kopiere den Theme-Ordner in deine UI5 App (z.B. nach `webapp/themes/`)
3. Aktiviere das Theme in deiner `index.html`:

```html
<script id="sap-ui-bootstrap"
    src="resources/sap-ui-core.js"
    data-sap-ui-theme="my_custom_theme@themes/my_custom_theme"
    ...>
</script>
```

## Backend API

### POST /api/compile-theme

Kompiliert ein Theme basierend auf den angegebenen Parametern.

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

**Response**: ZIP-Datei mit dem kompilierten Theme

### POST /api/preview-theme

Kompiliert Theme-CSS für Live-Preview (nur 3 Libraries, schneller).

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

**Response**: Kompiliertes CSS als text/css

### GET /api/health

Health Check Endpoint

## Technologie-Stack

- **Frontend**: OpenUI5 1.96.40 (JavaScript)
- **Backend**: Node.js, Express
- **Authentication**: Passport.js mit OAuth 2.0 / OpenID Connect (Keycloak)
- **Database**: better-sqlite3 (SQLite)
- **Theme Compiler**: less-openui5
- **Weitere Packages**: archiver, cors, body-parser, concurrently, express-session

## Environment Variables

### OAuth Authentication (Optional)

Wenn OAuth/OIDC Authentifizierung verwendet werden soll:

```bash
KEYCLOAK_URL=https://your-keycloak-instance.com
KEYCLOAK_REALM=your-realm
KEYCLOAK_CLIENT_ID=theme-designer
KEYCLOAK_CLIENT_SECRET=your-client-secret
SESSION_SECRET=your-random-secret  # Generate: openssl rand -base64 32
```

### Weitere (Optional)

```bash
PORT=3001                    # API server port (default: 3001)
NODE_ENV=production          # Node environment (default: development)
```

**Hinweis**: Ohne OAuth können Themes lokal erstellt werden (User: 'anonymous').

## Verfügbare npm Scripts

| Script | Beschreibung |
|--------|--------------|
| `npm install` | Installiert alle Dependencies (UI5 + Server) |
| `npm run start:all` | ⭐ Startet Backend + Frontend gleichzeitig |
| `npm run start:ui` | Startet nur die UI5 App (Port 8080) |
| `npm run start:server` | Startet nur den Backend Server (Port 3001) |
| `npm start` | Alias für `start:ui` |
| `npm run build` | Baut die UI5 App |
| `npm run lint` | Linter für Code-Qualität |
| `npm test` | Führt Tests aus |

## Struktur des exportierten Themes

```
my_custom_theme.zip
├── README.md
└── my_custom_theme/
    ├── library.css          # Kompiliertes CSS
    ├── library-RTL.css      # Right-to-Left CSS
    ├── library-parameters.json  # Theme Parameter
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
