# SSH-Delivery

Do fast files deploy with SFTP. Support servers chain.

## Install

```sh
npm install -g ssh-delivery
```

## Configure

Create config with tasks and servers declaration. Default config file names :

```
$HOME/.deliveryrc
$HOME/.delivery.js
./.deliveryrc
./.delivery.js
```

```js
const fs = require('fs');
const path = require('path');

module.exports = {
  // SSH servers (all server options see at https://github.com/mscdex/ssh2#client-methods `connect` method)
  // Upload destination servers should support SFTP. Gateway servers should support port forwarding.
  servers: {
    gate: {
      alias: 'gate',
      host: 'gate.myweb.com',
      username: 'root',
      password: 'secret',
    },
    web: {
      host: 'myweb.com',
      port: 41022,
      username: 'root',
      privateKey: fs.readFileSync(path.resolve(os.homedir(), '.ssh', 'id_rsa')),
      passphrase: 'secret',
      via: 'gate', // Connection to this server will be made via 'gate' server
    },
  },

  // Delivery tasks
  tasks: {
    deployToWebServer: {
      // Commands before uploading
      before: {
        run: ['npm run build'],
      },

      // Files to upload
      src: {
        path: './build/',
      },

      // Where should upload
      dst: {
        server: 'web', // server name from servers-section
        path: '/var/www/html', // path on remote server
      },

      // Commands after uploading
      after: {
        run: ['rm -rf ./build'],
      },
    },
  },
};
```

You can keep servers options secure in your home directory. Create `$HOME/.delivery.js` with content like this:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = {
  servers: {
    gate: {
      alias: 'gate',
      host: 'gate.myweb.com',
      username: 'root',
      password: 'secret',
    },
    web: {
      host: 'myweb.com',
      port: 41022,
      username: 'root',
      privateKey: fs.readFileSync(path.resolve(os.homedir(), '.ssh', 'id_rsa')),
      passphrase: 'secret',
      via: 'gate', // Connection to this server will be made via 'gate' server
    },
  },
}
```

and use serves `gate` and `web` in your separate configs without redeclaration.

## Run

Run `static` task with

```sh
delivery deployToWebServer
```

or with custom config path

```sh
delivery deployToWebServer -c ./custom-config.js
```

You can keep servers options with credentials in separate config
