import FastifyPlugin from 'fastify-plugin';

import { Api } from '../sfdc/api.js';
import { Connection } from '../sfdc/connection.js';

declare module 'fastify' {
    interface FastifyInstance {
        sfdc: {
            connection: Connection;
            api: Api;
        };
    }
}

interface SfdcPluginOptions {
    instanceUrl: string,
    accessToken: string,
}

export default FastifyPlugin<SfdcPluginOptions>(
    async (instance, opts) => {
        instance.log.debug('Establishing connection with SFDC instance');

        const connection = new Connection(opts);
        const api = new Api({ connection });

        instance.decorate('sfdc', {
            connection,
            api,
        });
    },
    {
        name: 'sfdc',
    },
);
