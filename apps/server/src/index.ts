import os from 'node:os';

import { buildApp } from './app.js';
import { config } from './config.js';
import { isLoopbackBind } from './http/host.js';
import { warmTokenizers } from './prompt/tokenizer.js';
import { getAuthFile } from './storage/auth.js';

// The Claude vocabulary is 1.7 MB; reading it before listening keeps the first
// generation from paying for the parse.
await warmTokenizers();

// Open desktop mode has no password, so it must never be reachable off the
// machine. Refuse to start rather than serve an unauthenticated API to the LAN.
if (config.desktop && !(await getAuthFile()) && !isLoopbackBind(config.host)) {
    process.stderr.write(
        `CatCup Tavern: CATCUP_DESKTOP is set with no access password, so it can only bind loopback. ` +
            `CATCUP_HOST is "${config.host}". Set a password or bind 127.0.0.1.\n`,
    );
    process.exit(1);
}

const app = await buildApp();

try {
    const address = await app.listen({ host: config.host, port: config.port });

    // The desktop shell starts this process with CATCUP_PORT=0 and reads the
    // port the OS picked from this line. Keep the prefix stable; it is the
    // readiness handshake, not a log message.
    const port = new URL(address).port;
    process.stdout.write(`CATCUP_READY ${port}\n`);

    const displayHost = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
    app.log.info(`CatCup Tavern is running at http://${displayHost}:${port}`);

    if (config.host === '0.0.0.0' || config.host === '::') {
        for (const addresses of Object.values(os.networkInterfaces())) {
            for (const address of addresses ?? []) {
                if (address.family === 'IPv4' && !address.internal) {
                    app.log.info(`LAN: http://${address.address}:${port}`);
                }
            }
        }
    }

    if (!(await getAuthFile())) {
        app.log.info('First run: open the app on this machine and set an access password.');
    }
} catch (error) {
    app.log.error(error);
    process.exitCode = 1;
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
        await app.close();
        process.exit(0);
    });
}
