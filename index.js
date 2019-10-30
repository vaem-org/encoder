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
const { Tail } = require('tail');
const _ = require('lodash');
const { fileSystemFromURL } = require('@vaem-util/filesystem');

let socket = false;
const ip = false;

let start = false;
config.instancePrefix = process.env.INSTANCE_PREFIX || '';
let encoderId = null;

const app = {};
app.config = config;

socket = app.socket = require('socket.io-client')(`${config.assetManager.parsedUrl.origin}/encoder`, {
  path: config.assetManager.parsedUrl.pathname + (config.assetManager.parsedUrl.pathname.endsWith('/') ? '' : '/')+ 'socket.io'
});

socket.on('connect', () => {
  console.log('Connected to asset manager');

  socket.emit('request-encoder-id', {
    encoderId: encoderId,
    token: config.assetManager.parsedUrl.username
  }, data => {
    if (!data) {
      console.error('Access denied');
      process.exit(1);
    }

    encoderId = data.encoderId;
    config.instancePrefix = `encoder.${encoderId}.`;
    config.destinationFileSystem = data.destinationFileSystem ? fileSystemFromURL(data.destinationFileSystem) : null;

    console.log(`Using encoder id: ${data.encoderId}`);

    socket.emit('info', {
      ip: ip,
      cpus: os.cpus(),
      hostname: os.hostname(),
      priority: parseInt(process.env.PRIORITY) || config.priority || 0
    });
  });
});

let tail = null;

socket.on('quit', () => {
  socket.disconnect();
  if (tail) {
    tail.unwatch();
  }
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

  const filename = `${config.root}/tmp/progress.log`;

  if (!await fs.exists(filename)) {
    await fs.writeFile(filename, '');
  }

  tail = new Tail(filename);

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

if (fs.existsSync(`${config.root}/tmp/progress.log`)) {
  app.initializeWatchers()
    .catch(e => console.error(e));
}

if (!fs.existsSync(`${config.root}/tmp`)) {
  fs.mkdirSync(`${config.root}/tmp`);
}

require('./app/start-job')(app);
