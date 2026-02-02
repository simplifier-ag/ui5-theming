# Theme Builder API Dockerfile
# Single image that supports multiple UI5 versions via runtime configuration
#
# Usage:
#   docker build -t theme-builder-api .
#   docker run -e UI5_VERSION=1.96.40 theme-builder-api
#   docker run -e UI5_VERSION=1.120.0 theme-builder-api

FROM node:22-alpine

# Install dependencies
RUN apk add --no-cache dumb-init

# Set working directory
WORKDIR /app

# Copy package template and application code
COPY package.template.json ./
COPY server.js theme-builder.js ./
COPY docker-entrypoint.sh ./

# Make entrypoint executable
RUN chmod +x docker-entrypoint.sh

# Create temp directory for theme compilation
RUN mkdir -p /app/temp && chown -R node:node /app

# Switch to non-root user
USER node

# Expose API port
EXPOSE 3000

# Default environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV UI5_VERSION=1.96.40

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Use custom entrypoint that runs setup if needed
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "docker-entrypoint.sh"]
