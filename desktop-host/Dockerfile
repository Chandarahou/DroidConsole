FROM node:22-slim

# Install modern ADB (download from Google instead of old Debian package)
RUN apt-get update && \
    apt-get install -y --no-install-recommends wget unzip ca-certificates && \
    wget -q https://dl.google.com/android/repository/platform-tools-latest-linux.zip -O /tmp/pt.zip && \
    unzip -q /tmp/pt.zip -d /opt && \
    rm /tmp/pt.zip && \
    apt-get purge -y wget unzip && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/platform-tools:${PATH}"

WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy source code
COPY src/ ./src/

# Create data directory for persistent nicknames
RUN mkdir -p /app/data

# Copy vendor files (scrcpy-server.jar must be provided)
COPY vendor/ ./vendor/

ENV NODE_ENV=production
ENV PORT=3001
ENV ADB_PATH=adb

EXPOSE 3001

CMD ["node", "src/index.js"]
