#!/usr/bin/env node

import { DeliveryOptions, ServerOptions, TaskOptions } from './types';
import createTunnel from './tunnel';
import { Server as NetServer } from 'net';
import net from 'net';
import { Client } from 'ssh2';
import path from 'path';
import fs from 'fs';
import * as tar from 'tar';
import { makeRandomFileName } from './utils/string';
import { spawn } from 'child_process';

export class Delivery {
  private options!: DeliveryOptions;
  constructor(options: DeliveryOptions) {
    Object.keys(options.servers).forEach((key) => {
      options.servers[key].name = key;
      options.servers[key].port ||= 22;
    });
    Object.keys(options.tasks).forEach((key) => {
      options.tasks[key].name = key;
    });
    this.options = options;
  }

  /**
   * Выполнить команду по доставке файлов
   * @param taskName
   */
  async run(taskName: string) {
    const taskOptions = this.options.tasks[taskName];
    if (!taskOptions) {
      throw new Error('unknown task');
    }

    const dstServerOptions = this.options.servers[taskOptions.dst.server];
    if (!dstServerOptions) {
      throw new Error('unknown dst server');
    }

    if (taskOptions.before?.run) {
      await this.runShellCommands(taskOptions.before.run);
    }

    const dstSshConnection = await this.createSshConnection(dstServerOptions);
    const uploadingArchivePath = await this.prepareUploadArchive(taskOptions);
    const remoteArchivePath = `/tmp/${uploadingArchivePath.split(path.sep).slice(-1)[0]}`;
    await this.uploadFile({
      sshConnection: dstSshConnection,
      srcPath: uploadingArchivePath,
      dstPath: remoteArchivePath,
    });
    await this.unpackArchiveOnRemoteServer({
      sshConnection: dstSshConnection,
      archivePath: remoteArchivePath,
      dstPath: taskOptions.dst.path,
    });

    fs.unlinkSync(uploadingArchivePath);

    if (taskOptions.after) {
      await this.runShellCommands(taskOptions.after.run);
    }
  }

  async runShellCommands(commands: string | string[]) {
    if (typeof commands === 'string') {
      commands = [commands];
    }
    const line1 = '================================';
    const line2 = '--------------------------------';
    for (const command of commands) {
      console.info(`${line1}\n• Run: ${command}\n${line2}`);
      await new Promise<void>((resolve, reject) => {
        const [mainCommand, ...args] = command.split(' ');

        const proc = spawn(mainCommand, args);

        proc.stdout.on('data', function (data) {
          console.info('\x1b[1m', (data as Buffer).toString(), '\x1b[0m');
        });

        proc.stderr.on('data', function (data) {
          console.error('\x1b[31m', (data as Buffer).toString(), '\x1b[0m');
        });

        proc.on('exit', function (code) {
          if (code === 0) {
            resolve();
          } else {
            reject();
          }
        });
      });
      console.info(`${line1}\n\n`);
    }
  }

  /**
   * Приготовить подключение к целевому серверу (при необходимости построить цепочку туннелей)
   * @param serverOptions
   */
  async createSshConnection(serverOptions: ServerOptions): Promise<Client> {
    process.stdout.write('• Prepare SSH connection... ');

    const serversChain: ServerOptions[] = (() => {
      const result: ServerOptions[] = [];
      const addServerToChain = (server: ServerOptions) => {
        result.push(server);
        if (server.via) {
          const viaServer = this.options.servers[server.via];
          if (!viaServer) {
            throw new Error(`via server "${server.via}" for dst server "${server.name}" not found`);
          }
          addServerToChain(viaServer);
        }
      };
      addServerToChain(serverOptions);
      return result;
    })().reverse();

    const dstConnectionTarget = {
      host: serverOptions.host,
      port: serverOptions.port,
    };

    // Если в цепочке несколько серверов - то нужно создавать тунели
    if (serversChain.length > 1) {
      const tunnelsChain: NetServer[] = [];
      for (let i = 0; i <= serversChain.length - 2; i++) {
        const gateServer = serversChain[i];
        const targetServer = serversChain[i + 1];

        if (i > 0) {
          const prevTunnelAddress = tunnelsChain[i - 1].address() as net.AddressInfo;
          gateServer.host = prevTunnelAddress.address;
          gateServer.port = prevTunnelAddress.port;
        }

        const tunnel = await createTunnel({
          username: gateServer.username,
          password: gateServer.password,
          host: gateServer.host,
          port: gateServer.port,
          dstHost: targetServer.host,
          dstPort: targetServer.port,
          localHost: '127.0.0.1',
          localPort: 0,
          socksProxyHost: gateServer.socksProxyHost,
          socksProxyPort: gateServer.socksProxyPort,
          socksProxyUsername: gateServer.socksProxyUsername,
          socksProxyPassword: gateServer.socksProxyPassword,
        });
        tunnelsChain.push(tunnel);
      }

      const lastTunnelAddress = tunnelsChain[tunnelsChain.length - 1].address() as net.AddressInfo;
      dstConnectionTarget.host = lastTunnelAddress.address;
      dstConnectionTarget.port = lastTunnelAddress.port;
    }

    const sshConnection = new Client();

    await new Promise<void>((resolve, reject) => {
      sshConnection
        .on('ready', () => resolve())
        .on('error', reject);
      const connectionOptions: any = {
        ...serverOptions,
        ...dstConnectionTarget,
      };
      if (serverOptions.socksProxyHost && serverOptions.socksProxyPort) {
        const { SocksClient } = require('socks');
        const socksOptions = {
          proxy: {
            host: serverOptions.socksProxyHost,
            port: serverOptions.socksProxyPort,
            type: 5,
            userId: serverOptions.socksProxyUsername,
            password: serverOptions.socksProxyPassword,
          },
          command: 'connect',
          destination: {
            host: serverOptions.host,
            port: serverOptions.port,
          },
          timeout: 10000,
        };
        SocksClient.createConnection(socksOptions)
          .then((info: any) => {
            connectionOptions.sock = info.socket;
            sshConnection.connect(connectionOptions);
          })
          .catch(reject);
      } else {
        sshConnection.connect(connectionOptions);
      }
    });

    process.stdout.write('DONE\n');

    return sshConnection;
  }

  /**
   * Подготовить архив для загрузки
   * @param taskOptions
   */
  async prepareUploadArchive(taskOptions: TaskOptions): Promise<string> {
    process.stdout.write('• Prepare archive... ');

    const archivePath = path.resolve(process.cwd(), `${makeRandomFileName()}.tgz`);
    const srcPath = path.resolve(taskOptions.src.path);

    // TODO проверить если srcPath это файл

    const result = await new Promise<string>((resolve, reject) => {
      tar.c(
        {
          gzip: true,
          file: archivePath,
          cwd: srcPath,
        },
        fs.readdirSync(srcPath),
        (err) => {
          if (err) {
            return reject(err);
          }
          return resolve(archivePath);
        }
      );
    });

    process.stdout.write('DONE\n');

    return result;
  }

  /**
   * Загрузить файл по SFTP
   * @param sshConnection
   * @param srcPath
   * @param dstPath
   */
  async uploadFile({ sshConnection, srcPath, dstPath }: { sshConnection: Client; srcPath: string; dstPath: string }) {
    process.stdout.write('• Upload archive... ');
    await new Promise<void>((resolve, reject) => {
      sshConnection.sftp((err, sftp) => {
        if (err) {
          return reject(err);
        }

        const readStream = fs.createReadStream(srcPath);
        const writeStream = sftp.createWriteStream(dstPath);

        writeStream.on('close', () => {
          resolve();
        });

        readStream.pipe(writeStream);
      });
    });
    process.stdout.write('DONE\n');
  }

  unpackArchiveOnRemoteServer({
    sshConnection,
    archivePath,
    dstPath,
  }: {
    sshConnection: Client;
    archivePath: string;
    dstPath: string;
  }) {
    process.stdout.write('• Unpack archive on server: \n');
    return new Promise<void>((resolve, reject) => {
      sshConnection.exec(
        `mkdir -p ${dstPath} && \
umask 0000 && \
mkdir -p ${archivePath}_extr
tar zxf ${archivePath} -C ${archivePath}_extr && \
cp -r ${archivePath}_extr/* ${dstPath} && \
rm ${archivePath}* -rf &&
echo ${dstPath} && \
ls -alh ${dstPath} `,
        (err, stream) => {
          if (err) {
            return reject(err);
          }
          stream
            .on('close', () => {
              resolve();
            })
            .on('data', (data: string) => {
              process.stdout.write(data);
            })
            .stderr.on('data', (data: string) => {
              process.stderr.write(data);
            });
        }
      );
    });
  }
}