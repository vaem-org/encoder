FROM vaem/node-ffmpeg:10.11.0-1

COPY . /app

WORKDIR /app

RUN yarn install

CMD ["npm", "start"]
