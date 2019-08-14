/*
 * VAEM - Asset manager
 * Copyright (C) 2018  Wouter van de Molengraft
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

require('dotenv').config();

const config = require('./config/config');
const fs = require('fs-extra');
const os = require('os');
const Tail = require('tail').Tail;
const _ = require('lodash');

let socket = false;
const ip = false;

let start = false;
config.instancePrefix = process.env.INSTANCE_PREFIX || '';
let encoderId = null;

const app = {};
app.config = config;

socket = app.socket = require('socket.io-client')(`${config.assetManager.url}/encoder`);
socket.on('connect', () => {
  console.log('Connected to asset manager');

  socket.emit('request-encoder-id', {
    encoderId: encoderId
  }, data => {
    encoderId = data.encoderId;
    config.instancePrefix = `encoder.${encoderId}.`;

    console.log(`Using encoder id: ${data.encoderId}`);

    socket.emit('info', {
      ip: ip,
      cpus: os.cpus(),
      hostname: os.hostname(),
      priority: parseInt(process.env.PRIORITY) || config.priority || 0
    });
  });
});

app.updateCurrentlyProcessing = data => {
  try {
    socket.emit('currently-processing', _.extend(data, {
      time: (new Date()).getTime()
    }));
  }
  catch (e) {
    console.log(e);
  }

  start = false;
};

let watchersInitialized = false;

const throttledEmit = _.throttle((event, params) => {
  socket.emit(event, params);
}, 250);

app.initializeWatchers = async () => {
  if (config.instancePrefix === watchersInitialized) {
    return;
  }

  const filename = `${config.root}/tmp/${config.instancePrefix}progress.log`;

  if (!await fs.exists(filename)) {
    await fs.writeFile(filename, '');
  }

  const tail = new Tail(filename);

  tail.on('line', data => {
    const result = /^out_time_ms=([0-9]+)$/.exec(data);

    if (result) {
      const current = parseInt(result[1]) / 1000 / 1000;

      if (start === false) {
        start = current;
      }

      throttledEmit('progress', {
        current: current,
        time: (new Date()).getTime(),
        start: start
      });
    }
  });
  watchersInitialized = config.instancePrefix;
};

if (fs.existsSync(`${config.root}/tmp/${config.instancePrefix}progress.log`)) {
  app.initializeWatchers()
    .catch(e => console.error(e));
}

if (!fs.existsSync(`${config.root}/tmp`)) {
  fs.mkdir(`${config.root}/tmp`, err => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
  });
}

require('./app/start-job')(app);
