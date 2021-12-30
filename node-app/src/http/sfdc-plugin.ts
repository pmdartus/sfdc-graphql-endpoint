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

export default FastifyPlugin(
    async (instance) => {
        instance.log.debug('Establishing connection with SFDC instance');

        const connection = await Connection.getConnection();
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
