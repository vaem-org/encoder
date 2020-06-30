const axios = require('axios');
const chokidar = require('chokidar');
const { relative } = require('path');
const { createReadStream, unlink } = require('fs-extra');
const config = require('../config/config');

const queue = [];

let handlingQueue = false;
async function handleQueue() {
  handlingQueue = true;
  const path = queue.shift();

  const relativePath = relative(config.root + '/tmp', path).split('/');

  const url = [
    decodeURIComponent(relativePath[0]),
    ...relativePath.slice(1)
    ].join('/');

  let tries = 10;
  let done = false;

  while (tries > 0 && !done) {
    try {
      await axios.put(
        url,
        createReadStream(path)
      );
      done = true;
    }
    catch (e) {
    }
    tries--;
  }

  if (!done) {
    console.warn(`Unable to upload ${url}`);
  }

  if (done) {
    await unlink(path);
  }

  if (queue.length !== 0) {
    handleQueue()
    .catch(e => {
      console.error(e);
    });
  } else {
    handlingQueue = false;
  }
}

let watcher = null;

function watch() {
  watcher = chokidar.watch(`${config.root}/tmp`, {
    awaitWriteFinish: true,
    ignoreInitial: true
  }).on('add', path => {
    queue.push(path);
    if (!handlingQueue) {
      handleQueue()
      .catch(e => {
        console.error(e);
      })
      ;
    }
  });
}

function stop() {
  watcher.close()
  .catch(e => {
    console.error(e);
  })
}

module.exports = {
  watch,
  stop
}
