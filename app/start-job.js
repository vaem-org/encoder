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

const { isArray } = require('lodash');
const { spawn } = require('child_process');

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
      'source': isArray(source) ? source[0] : source,
      parameters: job.videoParameters,
      width: job.width,
      bitrate: job.bitrate,
    });

    const arguments = [
      ...job.arguments,
      '-y',
      '-loglevel', 'error',
      '-threads', 0,
      '-progress', `${app.config.root}/tmp/progress.log`
    ];

    console.log('ffmpeg ', arguments.map(value => `'${value}'`).join(' '));

    child = spawn(
      'ffmpeg',
      arguments,
      {
        stdio: ['inherit', 'pipe', 'pipe'],
        env: {
          'PATH': process.env.PATH,
          'LD_LIBRARY_PATH': '/opt/ffmpeg/lib:/opt/ffmpeg/lib64'
        }
      }
    );

    ['stdout', 'stderr'].forEach(pipe => {
      child[pipe].on('data', data => {
        process[pipe].write(data);
        app.socket.emit(pipe, data);
      });
    });

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

          app.socket.emit('state', {
            status: 'idle'
          });
        }
      })
    }));

    app.socket.emit('m3u8', {
      filename: job.m3u8,
      asset: job.asset,
      bitrate: job.bitrate,
      codec: job.codec,
      bandwidth: job.bandwidth
    });

    console.log('Child process ended');

    app.socket.emit('state', {
      status: 'idle'
    });
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
