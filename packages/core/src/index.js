'use strict';

const schema = require('./schema');
const migration = require('./migration');
const local = require('./local-store');
const sync = require('./sync-engine');
const projection = require('./projection');

module.exports = { ...schema, ...migration, ...local, ...sync, ...projection };
