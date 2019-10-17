FROM jrottenberg/ffmpeg:4.2-alpine
FROM node:10.16.2-alpine

COPY --from=0 / /

WORKDIR /app

COPY package.json /app/package.json
COPY yarn.lock /app/yarn.lock

ENV NODE_ENV=production
RUN yarn install && yarn cache clean

COPY . /app

CMD ["npm", "start"]
