ARG TAG=12.18.0-alpine
FROM vaem/node-ffmpeg:${TAG}

WORKDIR /app

COPY package.json /app/package.json
COPY yarn.lock /app/yarn.lock

ENV NODE_ENV=production
RUN yarn install && yarn cache clean

COPY . /app

CMD ["npm", "start"]
