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

const _ = require('lodash');
const path = require('path');
const glob = require('glob-promise');
const child_process = require('child_process');
const fse = require('fs-extra');
const rp = require('request-promise');
const config = require('../config/config');

const ffprobe = filename => new Promise((accept, reject) => {
  child_process.execFile('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    '-allowed_extensions', 'ALL',
    filename], (err, stdout) => {
    if (err) {
      return reject(err);
    }

    let parsed = null;
    try {
      parsed = JSON.parse(stdout);
    }
    catch (e) {
      return reject('Unable to parse ffprobe json');
    }

    accept(parsed);
  });
});

async function upload(source, destination) {
  const { stream } = await config.destinationFileSystem.write(destination);
  return new Promise((accept, reject) => {
    const input = fse.createReadStream(source)
      .on('error', reject);

    stream
      .on('error', reject)
      .on('done', accept)
    ;

    input.pipe(stream);
  });
}

module.exports = app => {
  let child = null;

  const startJob = async (job, response) => {
    if (child) {
      return response({
        success: false,
        msg: 'Already running a job'
      });
    }

    let source = job.source;

    console.log(`Starting job for ${job.m3u8}`);

    app.updateCurrentlyProcessing({
      'source': _.isArray(source) ? source[0] : source,
      parameters: job.videoParameters,
      width: job.width,
      bitrate: job.bitrate,
    });

    const tmpDir = `${config.root}/tmp/segments/${path.basename(job.m3u8).replace('%v', 'v')}`;
    await fse.ensureDir(tmpDir);
    const filename = path.basename(job.m3u8);

    const arguments = [
      ...job.arguments,
      '-y',
      '-loglevel', 'error',
      '-threads', 0,
      '-progress', `${app.config.root}/tmp/progress.log`,
      '-hls_segment_filename', `${tmpDir}/${job.segmentFilename}`,
      `${tmpDir}/${filename}`
    ];

    console.log('ffmpeg ', arguments.map(value => `'${value}'`).join(' '));

    child = child_process.spawn(
      'ffmpeg',
      arguments,
      {
        stdio: 'inherit',
        env: {
          'PATH': process.env.PATH
        },
        detached: true
      }
    );

    child.unref();

    app.socket.emit('state', {
      status: 'running'
    });

    response({success: true});

    app.initializeWatchers()
      .catch(e => console.error(e));

    await (new Promise((accept, reject) => {
      child.on('close', code => {
        child = null;
        if (code === 0) {
          accept();
        } else {
          reject('ffmpeg failed');
        }

        app.socket.emit('state', {
          status: 'error'
        });
      })
    }));

    console.log('Child process ended');

    app.socket.emit('state', {
      status: 'idle'
    });

    // upload segments
    app.uploading = true;
    const files = await glob(`${tmpDir}/*`, {nodir: true});
    const destinationPrefix = path.dirname(job.m3u8);

    for(let file of files) {
      if (config.destinationFileSystem) {
        const dirname = path.basename(destinationPrefix);
        const destination = `${dirname}/${path.basename(file)}`;
        console.log(`Uploading '${destination}' to filesystem`);
        let tries = 10;
        let done = false;

        while(tries > 0 && !done) {
          try {
            await upload(file, destination);
            done = true;
          } catch (e) {
            tries--;

            console.info(`Retrying ${destination} (${e.toString()}`);
            // wait for 2 seconds and try again
            await (new Promise(accept => setTimeout(accept, 2000)));
          }
        }
        if (!done) {
          throw `Unable to upload ${destination}`;
        }
      } else {
        console.log(`Uploading ${config.assetManager.url}${destinationPrefix}/${path.basename(file)}`);
        await rp(`${config.assetManager.url}${destinationPrefix}/${path.basename(file)}`, {
          method: 'PUT',
          body: fse.createReadStream(file),
          auth: config.assetManager.auth
        });
      }
    }

    if (job.hlsEncKey) {
      await fse.writeFile(`${tmpDir}/file.key`, Buffer.from(job.hlsEncKey, 'hex'));
    }

    const filenames = await glob(`${tmpDir}/*.m3u8`, {nodir: true});

    const ffprobes = [];

    for(let file of filenames) {
      ffprobes.push(await ffprobe(file));
    }

    app.socket.emit('m3u8', {
      filename: job.m3u8,
      asset: job.asset,
      bitrate: job.bitrate,
      codec: job.codec,
      bandwidth: job.bandwidth,
      filenames,
      ffprobes
    });

    await fse.remove(tmpDir);

    app.uploading = false;
    app.events.emit('done-uploading');
  };

  app.socket.on('new-job', (job, response) => {
    startJob(job, response)
      .catch(e => console.error(e));
  });

  app.socket.on('stop', () => {
    if (child) {
      child.kill();
    }
  });
};
