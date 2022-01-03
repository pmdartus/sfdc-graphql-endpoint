import { buildClientSchema, getIntrospectionQuery, printSchema } from 'graphql';

import getApp from '../src/http/app.js';

import { gql } from './utils.js';

const instanceUrl = process.env.INSTANCE_URL;
const accessToken = process.env.ACCESS_TOKEN;

if (!instanceUrl || !accessToken) {
    let msg = `INSTANCE_URL and ACCESS_TOKEN environment variables must be set to run the integration tests.\n`;
    msg += `Run "sfdx force:user:display" from the "integration/sfdx-org" directory to retrieve those informations.`;

    throw new Error(msg);
}

describe('Sample entity', () => {
    const app = getApp({
        instanceUrl,
        accessToken,
        entities: ['Sample__c'],
    });

    async function executeQuery({ query }: { query: string }): Promise<any> {
        const response = await app.inject({
            method: 'POST',
            url: '/graphql',
            payload: {
                query,
            },
        });

        expect(response.statusCode).toBe(200);
        return response.json();
    }

    test('introspect schema', async () => {
        const { data } = await executeQuery({
            query: getIntrospectionQuery({
                schemaDescription: true,
            }),
        });

        const schema = buildClientSchema(data);
        expect(printSchema(schema)).toMatchSnapshot();
    });

    test('retrieve all the sample records', async () => {
        const { data } = await executeQuery({
            query: gql`
                {
                    Sample__c(limit: 100) {
                        id
                        name
                    }
                }
            `,
        });

        expect(data).toMatchObject({
            Sample__c: expect.any(Array),
        });

        for (const record of data.Sample__c) {
            expect(record).toMatchObject({
                id: expect.any(String),
                name: expect.any(String),
            });
        }
    });

    test('retrieve 2 records', async () => {
        const { data } = await executeQuery({
            query: gql`
                {
                    Sample__c(limit: 2) {
                        name
                    }
                }
            `,
        });

        expect(data.Sample__c).toHaveLength(2);
    });

    test('retrieve records ordered by name ASC', async () => {
        const { data } = await executeQuery({
            query: gql`
                {
                    Sample__c(limit: 10, order_by: { name: ASC }) {
                        name
                    }
                }
            `,
        });

        const names: string[] = data.Sample__c.map((record: any) => record.name);
        expect(names).toEqual([...names].sort());
    });

    test('retrieve records ordered by name DESC', async () => {
        const { data } = await executeQuery({
            query: gql`
                {
                    Sample__c(limit: 10, order_by: { name: DESC }) {
                        name
                    }
                }
            `,
        });

        const names: string[] = data.Sample__c.map((record: any) => record.name);
        expect(names).toEqual([...names].sort((a, b) => b.localeCompare(a)));
    });

    // TODO: Fix me, something is wrong with the offset.
    test.skip('retrieve next record using offset', async () => {
        const fetchAllRes = await executeQuery({
            query: gql`
                {
                    Sample__c(limit: 4) {
                        id
                        name
                    }
                }
            `,
        });
        const [firstRecordId, nextRecordId] = fetchAllRes.data.Sample__c.map(
            (record: any) => record.id,
        );

        const fetchFirstRes = await executeQuery({
            query: gql`
                {
                    Sample__c(limit: 1, offset: 0) {
                        id
                        name
                    }
                }
            `,
        });
        expect(fetchFirstRes.data.Sample__c[0].id).toBe(firstRecordId);

        const fetchNextRes = await executeQuery({
            query: gql`
                {
                    Sample__c(limit: 1, offset: 0) {
                        id
                        name
                    }
                }
            `,
        });
        expect(fetchNextRes.data.Sample__c[0].id).toBe(nextRecordId);
    });
});
