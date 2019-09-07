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

/**
 * Convert an associative array to a flat array for passing as arguments to ffmpeg
 * @param params
 */
const getParams = params => {
  const result = [];
  _.each(params, (value, key) => {
    if (value !== null) {
      (typeof value === 'object' ? value : [value]).forEach(value => {
        result.push('-' + key);
        if (value !== true) {
          result.push(value);
        }
      });
    }
  });

  return result;
};

const ffprobe = filename => new Promise((accept, reject) => {
  child_process.execFile('ffprobe', getParams({
    v: 'quiet',
    print_format: 'json',
    show_format: true,
    show_streams: true,
    allowed_extensions: 'ALL'
  }).concat([filename]), (err, stdout) => {
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
      .on('end', accept)
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
      bitrate: job.options.maxrate,
      pass: job.options.pass
    });

    const tmpDir = `${config.root}/tmp/segments/${path.basename(job.m3u8)}`;
    await fse.ensureDir(tmpDir);
    const filename = path.basename(job.m3u8);

    const params = _.extend({},
      typeof job.options.seekable !== 'undefined' ? {
        'seekable': job.options.seekable
      } : {}, {
        'ss': job.options.ss || null,
        'i': source,
        'y': true,
        'loglevel': 'error',
        'threads': 0,
        'progress': `${app.config.root}/tmp/progress.log`,

      }, _.omit(job.options, ['ss', 'seekable']), {
        'f': 'hls',
        'hls_list_size': 0,
        'hls_playlist_type': 'vod',
        'hls_time': 2,
        'hls_segment_filename': `${tmpDir}/${filename.replace(/\.m3u8$/, '.%05d.ts')}`
      }, job.segmentOptions || {});

    const arguments = getParams(params).concat(`${tmpDir}/${filename}`);

    console.log('Starting ffmpeg with ', arguments.join(' '));

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

    child.on('close', code => {
      (async () => {
        child = null;
        console.log('Child process ended');

        if (code !== 0) {
          console.log('ffmpeg failed');
          app.socket.emit('state', {
            status: 'error'
          });
          return;
        }

        app.socket.emit('state', {
          status: 'idle'
        });

        // upload segments
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

        app.socket.emit('m3u8', {
          filename: job.m3u8,
          ffprobe: await ffprobe(`${tmpDir}/${filename}`)
        });

        await fse.remove(tmpDir);
      })()
        .catch(e => {
          console.error(e);
        });
    });
    response({success: true});

    app.initializeWatchers()
      .catch(e => console.error(e));
  };

  app.socket.on('new-job', (job, response) => {
    startJob(job, response)
      .catch(e => console.error(e));
  });
};
