FROM vaem/node-ffmpeg:10.16.2-alpine

COPY . /app

WORKDIR /app

ENV NODE_ENV=production
RUN yarn install

CMD ["npm", "start"]
