FROM vaem/node-ffmpeg:10.11.0

COPY . /app

WORKDIR /app

RUN yarn install

CMD ["npm", "start"]
