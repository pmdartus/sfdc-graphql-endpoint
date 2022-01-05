import Fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';

import { graphqlFastifyPlugin, SfdcGraphQLOptions } from './graphql.js';

export default function(opts: FastifyServerOptions & SfdcGraphQLOptions): FastifyInstance {
    const app = Fastify(opts);
    
    app.register(graphqlFastifyPlugin(opts));
    
    app.get('/', (_, response) => {
        response.redirect('/graphql');
    });

    return app;
}