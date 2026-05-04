FROM vaem/node-ffmpeg:20.11.1-alpine AS base

WORKDIR /app

RUN corepack enable

ADD ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml /app/

ENV NODE_ENV=production

RUN pnpm install --production

ADD . /app

USER 1000

CMD ["node", "src/index.js"]
