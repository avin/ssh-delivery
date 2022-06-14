import { ConnectConfig } from 'ssh2';

export type ServerOptions = ConnectConfig & { name: string; via?: string };

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
  servers: Record<string, ServerOptions>;
  tasks: Record<string, TaskOptions>;
};
