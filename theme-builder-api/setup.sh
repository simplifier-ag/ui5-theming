#!/bin/bash
# Theme Builder API - Version Setup Script
#
# Usage:
#   ./setup.sh 1.96.40    # Setup for UI5 1.96.40
#   ./setup.sh 1.120.0    # Setup for UI5 1.120.0

set -e

UI5_VERSION=$1

if [ -z "$UI5_VERSION" ]; then
    echo "❌ Error: UI5 version required"
    echo ""
    echo "Usage: ./setup.sh <version>"
    echo "Example: ./setup.sh 1.96.40"
    echo ""
    echo "Supported versions:"
    echo "  - 1.96.40"
    echo "  - 1.120.0"
    exit 1
fi

TEMPLATE_FILE="package.template.json"

if [ ! -f "$TEMPLATE_FILE" ]; then
    echo "❌ Error: $TEMPLATE_FILE not found"
    exit 1
fi

echo "🔧 Setting up Theme Builder API for UI5 $UI5_VERSION..."
echo ""

# Backup existing node_modules if switching versions
if [ -d "node_modules" ]; then
    CURRENT_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
    if [ "$CURRENT_VERSION" != "$UI5_VERSION" ]; then
        echo "⚠️  Detected version change (${CURRENT_VERSION} → ${UI5_VERSION})"
        echo "   Removing old node_modules..."
        rm -rf node_modules
    fi
fi

# Generate package.json from template
sed "s/{{VERSION}}/$UI5_VERSION/g" "$TEMPLATE_FILE" > package.json
echo "✓ Generated package.json for UI5 $UI5_VERSION from template"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

echo ""
echo "✅ Setup complete!"
echo ""
echo "Start the server with:"
echo "  npm start"
echo ""
echo "Or set UI5_VERSION environment variable:"
echo "  UI5_VERSION=$UI5_VERSION npm start"
