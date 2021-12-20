FROM vaem/node-ffmpeg:16.13.0-alpine as base

WORKDIR /app

ADD ./package.json ./yarn.lock /app/

ENV NODE_ENV=production

RUN yarn install --production

ADD . /app

USER 1000

CMD ["node", "src/index.js"]
