import * as net from 'net';
import * as events from 'events';
import { Client, ClientChannel, ConnectConfig } from 'ssh2';
import { Server, Socket } from 'net';

type TunnelConfig = ConnectConfig & {
  dstHost: string;
  dstPort: number;
  localHost: string;
  localPort: number;
  srcHost: string;
  srcPort: number;
};

function bindSSHConnection(config: TunnelConfig, netConnection: Socket): Client {
  const sshConnection = new Client();
  netConnection.on('close', sshConnection.end.bind(sshConnection));

  sshConnection.on('ready', () => {
    netConnection.emit('sshConnection', sshConnection, netConnection);
    sshConnection.forwardOut(config.srcHost, config.srcPort, config.dstHost, config.dstPort, (err, sshStream) => {
      if (err) {
        // Bubble up the error => netConnection => server
        netConnection.emit('error', err);
        return;
      }

      netConnection.emit('sshStream', sshStream);
      netConnection.pipe(sshStream).pipe(netConnection);
    });
  });
  return sshConnection;
}

function omit<T extends object, K extends Extract<keyof T, string>>(obj: T, keys: K[]): Omit<T, K> {
  return keys.reduce((copyObj, key) => {
    delete copyObj[key];
    return copyObj;
  }, Object.assign({}, obj));
}

function createServer(config: TunnelConfig): Server {
  const connections: (Client | Socket)[] = [];
  let connectionCount = 0;

  const server = net.createServer((netConnection: Socket) => {
    connectionCount++;
    netConnection.on('error', () => {
      server.emit('error');
    });
    netConnection.on('close', () => {
      connectionCount--;
      if (connectionCount === 0) {
        setTimeout(() => {
          if (connectionCount === 0) {
            server.close();
          }
        }, 2);
      }
    });

    server.emit('netConnection', netConnection, server);
    const sshConnection = bindSSHConnection(config, netConnection);
    sshConnection.on('error', () => {
      server.emit('error');
    });

    netConnection.on('sshStream', (sshStream: ClientChannel) => {
      sshStream.on('error', () => {
        server.close();
      });
    });

    connections.push(sshConnection, netConnection);
    try {
      sshConnection.connect(omit(config, ['localPort', 'localHost']));
    } catch (error) {
      server.emit('error', error);
    }
  });

  server.on('close', () => {
    connections.forEach((connection) => {
      connection.end();
    });
  });

  return server;
}

function createTunnel(configArgs: Partial<TunnelConfig>): Promise<Server> {
  return new Promise((resolve, reject) => {
    try {
      const env = process.env;
      const config: TunnelConfig = {
        username: env.TUNNELSSH_USER || env.USER || env.USERNAME || 'root',
        port: 22,
        srcPort: 0,
        srcHost: '127.0.0.1',
        dstHost: '127.0.0.1',
        dstPort: 22,
        localHost: '127.0.0.1',
        localPort: 0,
        agent: env.SSH_AUTH_SOCK,
        ...configArgs,
      };
      const server = createServer(config);

      server.listen(config.localPort, config.localHost, () => {
        resolve(server);
      });
    } catch (error) {
      const server = new events.EventEmitter();
      setImmediate(() => {
        server.emit('error', error);
        reject(error);
      });
    }
  });
}

export default createTunnel;
