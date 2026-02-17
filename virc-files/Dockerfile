FROM oven/bun:1.3 AS base
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

COPY src/ ./src/

# Install curl for health check
RUN apt-get update -qq && apt-get install -y -qq curl && rm -rf /var/lib/apt/lists/*

# Run as non-root user
RUN groupadd --system accord && useradd --system --gid accord --no-create-home accord \
    && mkdir -p /app/uploads /app/data \
    && chown -R accord:accord /app
USER accord

EXPOSE 8080
CMD ["bun", "run", "src/index.ts"]
