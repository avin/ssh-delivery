import { DeliveryOptions, ServerOptions, TaskOptions } from './types';
import createTunnel from './tunnel';
import { Server as NetServer } from 'net';
import net from 'net';
import { Client } from 'ssh2';
import path from 'path';
import fs from 'fs';
import * as tar from 'tar';
import { makeRandomFileName } from './utils/string';
import { exec } from 'child_process';

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
    dstSshConnection.end();

    if (taskOptions.after) {
      await this.runShellCommands(taskOptions.after.run);
    }
  }

  async runShellCommands(commands: string | string[]) {
    if (typeof commands === 'string') {
      commands = [commands];
    }
    for (const command of commands) {
      await new Promise<void>((resolve, reject) => {
        console.log(`Run: ${command}`);
        exec(command, (err, stdout, stderr) => {
          if (err) {
            return reject();
          }
          if (stderr) {
            console.error(`stderr: ${stderr}`);
            return;
          }
          console.log(`stdout: ${stdout}`);

          return resolve();
        });
      });
    }
  }

  /**
   * Приготовить подключение к целевому серверу (при необходимости построить цепочку туннелей)
   * @param serverOptions
   */
  async createSshConnection(serverOptions: ServerOptions): Promise<Client> {
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
        // TODO on fail
        .connect({
          ...serverOptions,
          ...dstConnectionTarget,
        });
    });

    return sshConnection;
  }

  /**
   * Подготовить архив для загрузки
   * @param taskOptions
   */
  prepareUploadArchive(taskOptions: TaskOptions): Promise<string> {
    const archivePath = path.resolve(process.cwd(), `${makeRandomFileName()}.tgz`);
    const srcPath = path.resolve(taskOptions.src.path);

    // TODO проверить если srcPath это файл

    return new Promise((resolve, reject) => {
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
        },
      );
    });
  }

  /**
   * Загрузить файл по SFTP
   * @param sshConnection
   * @param srcPath
   * @param dstPath
   */
  uploadFile({ sshConnection, srcPath, dstPath }: { sshConnection: Client; srcPath: string; dstPath: string }) {
    return new Promise<void>((resolve, reject) => {
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
    return new Promise<void>((resolve, reject) => {
      sshConnection.exec(
        `\
mkdir -p ${dstPath} && \
umask 0000 && \
mkdir -p ${archivePath}_extr
tar zxf ${archivePath} -C ${archivePath}_extr && \
cp ${archivePath}_extr/* ${dstPath} && \
rm ${archivePath}* -rf &&
echo ${dstPath} && \
ls -alh ${dstPath} \
`,
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
        },
      );
    });
  }
}
