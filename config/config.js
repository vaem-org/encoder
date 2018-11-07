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

const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const {URL} = require('url');

assetManager = {
  url: 'http://localhost:1234/'
};

if (process.env.ASSETMANAGER_URL) {
  const parsed = new URL(process.env.ASSETMANAGER_URL);

  assetManager = {
    url: _.trim(`${parsed.protocol}//${parsed.host}${parsed.pathname}`, '/'),
    auth: parsed.username && {
      username: parsed.username,
      password: parsed.password,
      sendImmediately: true
    }
  }
}

const config = {
  global: {
    assetManager: assetManager,
    root: path.dirname(__dirname),
    source: false
  },
  production:
    {},
  development:
    {}
};

module.exports = _.extend(
  config.global,
  config[process.env.NODE_ENV || 'development'] || {},
  fs.existsSync(`${__dirname}/local.js`) ? require(`${__dirname}/local.js`) : {}
);
