import Fastify from 'fastify';

import { graphqlFastifyPlugin } from './graphql.js';

const port = process.env.PORT ?? 3000;
const __prod__ = process.env.NODE_ENV === 'production';

const fastify = Fastify({
    logger: {
        level: __prod__ ? 'log' : 'debug',
    },
});

fastify.register(graphqlFastifyPlugin);

fastify.get('/', (_, response) => {
    response.redirect('/graphql');
});

fastify.listen(port, (err) => {
    if (err) {
        fastify.log.error(err);
        process.exit(1);
    }
});
