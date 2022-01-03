import Fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';

import { graphqlFastifyPlugin } from './graphql.js';

export interface ServerOptions extends FastifyServerOptions {
    entities: string[]
}

export default function(opts: ServerOptions): FastifyInstance {
    const app = Fastify(opts);
    
    app.register(graphqlFastifyPlugin(opts));
    
    app.get('/', (_, response) => {
        response.redirect('/graphql');
    });

    return app;
}