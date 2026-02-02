#!/bin/sh
# Theme Builder API - Docker Entrypoint
# Automatically runs setup if needed, then starts the server

set -e

UI5_VERSION=${UI5_VERSION:-1.96.40}

echo "🚀 Starting Theme Builder API for UI5 ${UI5_VERSION}..."
echo ""

# Check if setup is needed
NEEDS_SETUP=false

if [ ! -f "package.json" ]; then
    echo "📦 package.json not found - setup required"
    NEEDS_SETUP=true
elif [ ! -d "node_modules" ]; then
    echo "📦 node_modules not found - setup required"
    NEEDS_SETUP=true
elif [ -z "$(ls -A node_modules 2>/dev/null)" ]; then
    echo "📦 node_modules is empty - setup required"
    NEEDS_SETUP=true
else
    # Check if current package.json matches requested version
    CURRENT_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
    if [ "$CURRENT_VERSION" != "$UI5_VERSION" ]; then
        echo "⚠️  Version mismatch: installed=${CURRENT_VERSION}, requested=${UI5_VERSION}"
        echo "   Setup required"
        NEEDS_SETUP=true
    else
        echo "✓ Setup already complete for UI5 ${UI5_VERSION}"
        echo "  Skipping npm install"
    fi
fi

# Run setup if needed
if [ "$NEEDS_SETUP" = true ]; then
    echo ""
    echo "🔧 Running setup for UI5 ${UI5_VERSION}..."
    echo ""

    # Generate package.json from template
    if [ ! -f "package.template.json" ]; then
        echo "❌ Error: package.template.json not found"
        exit 1
    fi

    sed "s/{{VERSION}}/${UI5_VERSION}/g" package.template.json > package.json
    echo "✓ Generated package.json for UI5 ${UI5_VERSION}"

    # Install dependencies
    echo ""
    echo "📦 Installing dependencies (this may take a minute)..."
    npm install --omit=dev

    echo ""
    echo "✅ Setup complete!"
fi

echo ""
echo "🌐 Starting server on port ${PORT:-3000}..."
echo ""

# Start the server
exec node server.js
