# Production runtime for OpenUI5 Theme Designer
# Supports linux/amd64 and linux/arm64
# Uses static nginx binary (avoids ARM64 QEMU emulation issues with Alpine packages)

FROM node:22-alpine

LABEL org.opencontainers.image.source="https://dev.azure.com/simplifierag/Simplifier/_git/theme-designer"
LABEL org.opencontainers.image.description="OpenUI5 Theme Designer - Custom theme builder for UI5 applications"
LABEL org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /app

# Install build dependencies (will be removed after nginx compilation)
RUN apk add --no-cache --virtual .build-deps \
        gcc \
        libc-dev \
        make \
        pcre-dev \
        zlib-dev \
        linux-headers \
        openssl-dev \
        curl

# Install runtime dependencies
RUN apk add --no-cache dumb-init wget pcre openssl zlib

# Download, compile and install nginx from source (static binary)
# Using source build avoids ARM64 QEMU issues with Alpine packages
RUN set -x && \
    curl -fSL https://nginx.org/download/nginx-1.26.2.tar.gz -o /tmp/nginx.tar.gz && \
    tar -xzf /tmp/nginx.tar.gz -C /tmp && \
    cd /tmp/nginx-1.26.2 && \
    ./configure \
        --prefix=/usr/local/nginx \
        --sbin-path=/usr/local/bin/nginx \
        --conf-path=/etc/nginx/nginx.conf \
        --error-log-path=/dev/stderr \
        --http-log-path=/dev/stdout \
        --pid-path=/tmp/nginx.pid \
        --lock-path=/tmp/nginx.lock \
        --with-http_gzip_static_module \
        --with-http_realip_module \
        --with-http_ssl_module \
        --with-pcre \
        --with-threads \
        --without-http_uwsgi_module \
        --without-http_scgi_module \
        --user=nobody \
        --group=nobody && \
    make -j$(nproc) && \
    make install && \
    mkdir -p /etc/nginx /usr/local/nginx/logs && \
    rm -rf /tmp/nginx* && \
    apk del .build-deps

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy pre-built UI5 app (built in CI pipeline)
COPY --chown=nodejs:nodejs dist ./dist

# Copy nginx configuration
COPY --chown=root:root nginx.conf /etc/nginx/nginx.conf

# Copy server files and install dependencies
COPY --chown=nodejs:nodejs server/package*.json ./server/
RUN cd server && npm ci --omit=dev

COPY --chown=nodejs:nodejs server/ ./server/

# Create temp directories
RUN mkdir -p /app/server/temp \
             /tmp/client_body \
             /tmp/proxy \
             /tmp/fastcgi && \
    chown -R nodejs:nodejs /app/server/temp && \
    chown -R nobody:nobody /tmp/client_body /tmp/proxy /tmp/fastcgi

# Create startup script
RUN echo '#!/bin/sh' > /app/start.sh && \
    echo '# Start API server in background' >> /app/start.sh && \
    echo 'cd /app/server && node server.js &' >> /app/start.sh && \
    echo 'API_PID=$!' >> /app/start.sh && \
    echo '' >> /app/start.sh && \
    echo '# Start nginx in foreground' >> /app/start.sh && \
    echo 'exec nginx -g "daemon off;"' >> /app/start.sh && \
    chmod +x /app/start.sh

# Expose only port 8080 (nginx serves UI and proxies API)
EXPOSE 8080

# Health check (via nginx proxy to /api/health)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start both servers
CMD ["/bin/sh", "/app/start.sh"]