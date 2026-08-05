# Playwright's own image already carries Chromium + every system library it
# needs, which is the fiddly part of running headless browsers in a container.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts
COPY config.json ./

# Seen-store lives here; mount a volume so restarts don't lose it.
RUN mkdir -p /app/data

# Chromium is unhappy as root in some hosts; the image ships a non-root user.
RUN chown -R pwuser:pwuser /app
USER pwuser

CMD ["node", "src/index.js"]
