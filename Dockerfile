FROM oven/bun:1.3.14-alpine

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile --production
COPY src ./src

RUN mkdir -p /data && chown -R bun:bun /app /data
USER 1000:1000

ENV PORT=3000 \
    DATABASE_PATH=/data/plugin.sqlite
EXPOSE 3000

CMD ["bun", "src/index.ts"]
