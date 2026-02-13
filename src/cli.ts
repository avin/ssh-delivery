#!/usr/bin/env node

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { Delivery } from './delivery';
import { DeliveryOptions } from './types';
import yargs from 'yargs/yargs';
import { validateConfig } from './validation';
import merge from 'lodash/merge';

const defaultConfigNames = [
  '.deliveryrc',
  '.deliveryrc.js',
  '.deliveryrc.cjs',
  '.delivery.config.js',
  'delivery.config.js',
  '.delivery.config.cjs',
  'delivery.config.cjs',
];

void (async () => {
  let delivery: Delivery | null = null;
  let isShuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    process.stdout.write(`\n• ${signal} received. Stop delivery...\n`);

    try {
      if (delivery) {
        await delivery.abort();
      }
    } catch (e) {
      console.error('!!!', (e as Error)?.message || e);
    } finally {
      process.exit(signal === 'SIGINT' ? 130 : 143);
    }
  };

  const onSigInt = () => {
    void shutdown('SIGINT');
  };
  const onSigTerm = () => {
    void shutdown('SIGTERM');
  };

  process.once('SIGINT', onSigInt);
  process.once('SIGTERM', onSigTerm);

  try {
    const argv = await yargs(process.argv.slice(2)).options({
      config: { type: 'string', alias: 'c', default: defaultConfigNames },
    }).argv;

    const argvConfig = (() => {
      if (typeof argv.config === 'string') {
        return [argv.config];
      }
      return argv.config;
    })();

    const taskName = argv._[0] as string;
    const configPaths = [...defaultConfigNames.map((fileName) => path.resolve(os.homedir(), fileName)), ...argvConfig];

    const config = (() => {
      let configObj: DeliveryOptions = {
        servers: {},
        tasks: {},
      };

      let someConfigFound = false;

      for (const configPath of configPaths) {
        if (!fs.existsSync(configPath)) {
          continue;
        }
        configObj = merge(configObj, require(path.resolve(configPath)) as Partial<DeliveryOptions>);
        someConfigFound = true;
      }

      if (!someConfigFound) {
        throw new Error('Config not found');
      }

      const validationResult = validateConfig(configObj);
      if (!validationResult.valid) {
        console.warn(validationResult.errors);
        throw new Error('Wrong config');
      }

      return configObj;
    })();

    delivery = new Delivery(config);
    await delivery.run(taskName);
    console.info('\n• Delivery successfully done!\n');
    process.exitCode = 0;
  } catch (e) {
    if (!isShuttingDown) {
      console.error('!!!', (e as Error)?.message || e);
      process.exitCode = 1;
    }
  } finally {
    process.removeListener('SIGINT', onSigInt);
    process.removeListener('SIGTERM', onSigTerm);
  }
})();
