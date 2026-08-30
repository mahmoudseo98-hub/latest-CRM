'use strict';

const http = require('http');
const path = require('path');
const { loadEnv } = require('./src/env');

loadEnv();

const { createApplication } = require('./src/app');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3000);
const application = createApplication({
  projectRoot: __dirname,
  dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data'),
});
const server = http.createServer(application.handler);

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 65_000;

server.listen(port, host, () => {
  const auth = application.context.authEnabled ? 'enabled' : 'DISABLED';
  console.log(`SEO For All OS is running on http://${host}:${port}`);
  console.log(`Authentication: ${auth}`);
  console.log(`LAN device access: ${application.context.allowLan ? 'enabled' : 'disabled'}`);
  if (process.env.NODE_ENV === 'production' && !application.context.authEnabled) {
    console.warn('WARNING: Set APP_USERNAME and APP_PASSWORD before exposing this application publicly.');
  }
});

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`);
  server.close(async () => {
    await application.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { server, application };
