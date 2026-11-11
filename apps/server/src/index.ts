import os from 'node:os';

import { buildApp } from './app.js';
import { config } from './config.js';
import { warmTokenizers } from './prompt/tokenizer.js';
import { getAuthFile } from './storage/auth.js';

// The Claude vocabulary is 1.7 MB; reading it before listening keeps the first
// generation from paying for the parse.
await warmTokenizers();

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
