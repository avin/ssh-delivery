#!/usr/bin/env node

import * as path from 'path';
import { Delivery } from './delivery';
import { DeliveryOptions } from './types';
import yargs from 'yargs/yargs';
import { validateConfig } from './validation';

void (async () => {
  try {
    const argv = await yargs(process.argv.slice(2)).options({
      config: { type: 'string', alias: 'c', default: './.delivery.js' },
    }).argv;

    const taskName = argv._[0] as string;
    const configPath = argv.config;

    const config = (() => {
      let configObj: DeliveryOptions;
      try {
        configObj = require(path.resolve(configPath)) as DeliveryOptions;
      } catch (e) {
        throw `Failed load config file "${configPath}"`;
      }

      const validationResult = validateConfig(configObj);
      if (!validationResult.valid) {
        console.log(validationResult.errors);
        throw new Error('Wrong config');
      }

      return configObj;
    })();

    const delivery = new Delivery(config);
    await delivery.run(taskName);
    console.log('*** Delivery successfully done! ***');
  } catch (e) {
    console.error('!!!', (e as Error)?.message || e);
    process.exit(1);
  }
})();
