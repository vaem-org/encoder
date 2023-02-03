/*
 * VAEM - Asset manager
 * Copyright (C) 2021  Wouter van de Molengraft
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

import 'dotenv/config';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { io } from 'socket.io-client';

const socket = io(process.env.ASSETMANAGER_URL);

let child = null;

socket.on('connect', () => {
  if (!child) {
    socket.emit('ready');
  }
});

socket.on('stop', () => {
  if (child) {
    child.kill();
  }
});

socket.on('new-job', () => {
  if (!child) {
    socket.emit('ready');
  }
});

socket.on('job', ({ job, ffmpegArguments }, callback) => {
  if (!child) {
    const input = ffmpegArguments[ffmpegArguments.indexOf('-i')+1];
    console.log(`Processing ${input}`)
    const errors = [];

    child = spawn('ffmpeg', [
      '-v', 'error',
      '-progress', 'pipe:1',
      ...ffmpegArguments
    ], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const readline = createInterface({
      input: child.stdout
    });

    readline.on('line', (line) => {
      const [key, value] = line.split('=');
      if (key === 'out_time_ms') {
        socket.emit('progress', {
          job,
          out_time_ms: value
        });
      }
    });

    child.stderr.on('data', buf => {
      errors.push(buf);
      process.stderr.write(buf);
    });

    child.on('error', (err) => {
      socket.emit('error', err);
    });

    child.on('close', code => {
      child = null;
      if (code === 0) {
        socket.emit('done', {
          job
        });
        socket.emit('ready');
      } else {
        socket.emit('error', {
          job,
          stderr: Buffer.concat(errors).toString()
        });
      }
    });
    callback(child !== null);
  } else {
    callback(false);
  }
});
