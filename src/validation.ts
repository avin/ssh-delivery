import { DeliveryOptions } from './types';
import revalidator from 'revalidator';

export const validateConfig = (config: DeliveryOptions) => {
  return revalidator.validate(config, {
    properties: {
      servers: {
        description: 'Servers',
        type: 'object',
        items: {
          description: 'Server options',
          type: 'object',
          properties: {
            alias: {
              description: 'Alias',
              type: 'string',
              required: true,
            },
            host: {
              description: 'Host',
              type: 'string',
              required: true,
            },
            port: {
              description: 'Port',
              type: 'number',
              required: false,
            },
          },
        },
      },
      tasks: {
        description: 'Tasks',
        type: 'object',
        items: {
          description: 'Task options',
          type: 'object',
          properties: {
            alias: {
              description: 'Task alias',
              type: 'string',
              required: true,
            },
            src: {
              description: 'Source files options',
              type: 'object',
              required: true,
              properties: {
                path: {
                  description: 'Source files path',
                  type: 'string',
                  required: true,
                },
              },
            },
            dst: {
              description: 'Destination files options',
              type: 'object',
              required: true,
              properties: {
                path: {
                  description: 'Destination files path on remote server',
                  type: 'string',
                  required: true,
                },
                server: {
                  description: 'Destination server name',
                  type: 'string',
                  required: true,
                },
              },
            },
            before: {
              description: 'Commands before upload',
              type: 'object',
              required: false,
              properties: {
                run: {
                  description: 'Commands to run array',
                  type: 'array',
                  items: {
                    type: 'string',
                  },
                },
              },
            },
            after: {
              description: 'Commands after upload',
              type: 'object',
              required: false,
              properties: {
                run: {
                  description: 'Commands to run array',
                  type: 'array',
                  items: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      },
    },
  });
};
