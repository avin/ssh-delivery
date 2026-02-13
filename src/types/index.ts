import { ConnectConfig } from 'ssh2';

export type UploadTuningOptions = {
  // Local file read stream highWaterMark (bytes)
  readHighWaterMarkBytes?: number;
  // Remote SFTP write stream highWaterMark (bytes)
  writeHighWaterMarkBytes?: number;
};

export type ServerOptions = ConnectConfig & {
  name: string;
  via?: string;
  socksProxyHost?: string;
  socksProxyPort?: number;
  socksProxyUsername?: string;
  socksProxyPassword?: string;
};

export type TaskOptions = {
  name: string;
  before?: {
    run: string[];
  };
  after?: {
    run: string[];
  };
  src: {
    path: string;
  };
  dst: {
    server: string;
    path: string;
  };
};

export type DeliveryOptions = {
  uploadTuning?: UploadTuningOptions;
  servers: Record<string, ServerOptions>;
  tasks: Record<string, TaskOptions>;
};
