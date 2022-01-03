import getApp from '../src/http/app';

it('Foo', async () => {
    const app = getApp({
        entities: ['Sample__c'],
    });

    const response = await app.inject({
        method: 'GET',
        url: '/graphql',
        query: {
            query: "{}"
        }
    });

    console.log(response.statusCode);
    console.log(response.body);
});
