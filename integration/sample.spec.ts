import { FastifyInstance } from 'fastify';
import { buildClientSchema, getIntrospectionQuery, printSchema } from 'graphql';

import { gql, getApp, executeQuery } from './utils.js';

let app: FastifyInstance;
beforeAll(() => {
    app = getApp({
        entities: ['Sample__c'],
    });
});

describe('Sample', () => {

    test('introspect schema', async () => {
        const { data } = await executeQuery({
            app,
            query: getIntrospectionQuery({
                schemaDescription: true,
            }),
        });

        const schema = buildClientSchema(data);
        expect(printSchema(schema)).toMatchSnapshot();
    });

    test('retrieve all the sample records', async () => {
        const { data } = await executeQuery({
            app,
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
            app,
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
            app,
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
            app,
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
            app,
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
            app,
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
            app,
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
