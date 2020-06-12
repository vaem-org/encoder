FROM vaem/node-ffmpeg:12.18.0-alpine

WORKDIR /app

COPY package.json /app/package.json
COPY yarn.lock /app/yarn.lock

ENV NODE_ENV=production
RUN yarn install && yarn cache clean

COPY . /app

CMD ["npm", "start"]
