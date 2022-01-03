import app from './app.js';

const port = process.env.PORT ?? 3000;
const __prod__ = process.env.NODE_ENV === 'production';

const instanceUrl = process.env.INSTANCE_URL;
const accessToken = process.env.ACCESS_TOKEN;
const entities = ['Account', 'User', 'Lead', 'Opportunity', 'Event'];

if (!instanceUrl || !accessToken) {
    throw new Error(`INSTANCE_URL and ACCESS_TOKEN environment variables must be set to start the server`);
}

const server = app({
    logger: {
        level: __prod__ ? 'log' : 'debug',
    },

    instanceUrl,
    accessToken,
    entities,
});

server.listen(port, (err) => {
    if (err) {
        server.log.error(err);
        process.exit(1);
    }
});
