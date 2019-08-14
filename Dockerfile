FROM jrottenberg/ffmpeg:4.1-alpine
FROM node:10.16.2-alpine

COPY --from=0 / /

COPY . /app

WORKDIR /app

ENV NODE_ENV=production
RUN yarn install

CMD ["npm", "start"]
