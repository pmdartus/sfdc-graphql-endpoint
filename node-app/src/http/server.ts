import Fastify from 'fastify';

import { graphqlFastifyPlugin } from './graphql.js';

const port = process.env.PORT ?? 3000;

const fastify = Fastify({
    logger: true,
});

fastify.register(graphqlFastifyPlugin);

fastify.get('/', (request, response) => {
    response.redirect('/graphql');
});

fastify.listen(port, (err) => {
    if (err) {
        fastify.log.error(err);
        process.exit(1);
    }
});
