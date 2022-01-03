import app from './app.js';

const port = process.env.PORT ?? 3000;
const __prod__ = process.env.NODE_ENV === 'production';

const server = app({
    logger: {
        level: __prod__ ? 'log' : 'debug',
    },
    entities: ['Account', 'User', 'Lead', 'Opportunity', 'Event'],
});

server.listen(port, (err) => {
    if (err) {
        server.log.error(err);
        process.exit(1);
    }
});
