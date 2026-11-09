import os from 'node:os';

import { buildApp } from './app.js';
import { config } from './config.js';
import { getAuthFile } from './storage/auth.js';

const app = await buildApp();

try {
    await app.listen({ host: config.host, port: config.port });

    const displayHost = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
    app.log.info(`CatCup Tavern is running at http://${displayHost}:${config.port}`);

    if (config.host === '0.0.0.0' || config.host === '::') {
        for (const addresses of Object.values(os.networkInterfaces())) {
            for (const address of addresses ?? []) {
                if (address.family === 'IPv4' && !address.internal) {
                    app.log.info(`LAN: http://${address.address}:${config.port}`);
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
