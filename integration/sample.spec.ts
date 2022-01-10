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
                        Id
                        Name
                    }
                }
            `,
        });

        expect(data).toMatchObject({
            Sample__c: expect.any(Array),
        });

        for (const record of data.Sample__c) {
            expect(record).toMatchObject({
                Id: expect.any(String),
                Name: expect.any(String),
            });
        }
    });

    test('retrieve 2 records', async () => {
        const { data } = await executeQuery({
            app,
            query: gql`
                {
                    Sample__c(limit: 2) {
                        Name
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
                    Sample__c(limit: 10, order_by: { Name: ASC }) {
                        Name
                    }
                }
            `,
        });

        const names: string[] = data.Sample__c.map((record: any) => record.Name);
        expect(names).toEqual([...names].sort());
    });

    test('retrieve records ordered by name DESC', async () => {
        const { data } = await executeQuery({
            app,
            query: gql`
                {
                    Sample__c(limit: 10, order_by: { Name: DESC }) {
                        Name
                    }
                }
            `,
        });

        const names: string[] = data.Sample__c.map((record: any) => record.Name);
        expect(names).toEqual([...names].sort((a, b) => b.localeCompare(a)));
    });

    test('retrieve next record using offset', async () => {
        const fetchAllRes = await executeQuery({
            app,
            query: gql`
                {
                    Sample__c(limit: 2, order_by: { Name: DESC }) {
                        Id
                        Name
                    }
                }
            `,
        });
        const [firstRecordId, nextRecordId] = fetchAllRes.data.Sample__c.map(
            (record: any) => record.Id,
        );

        const fetchFirstRes = await executeQuery({
            app,
            query: gql`
                {
                    Sample__c(limit: 1, offset: 0, order_by: { Name: DESC }) {
                        Id
                        Name
                    }
                }
            `,
        });
        expect(fetchFirstRes.data.Sample__c[0].Id).toBe(firstRecordId);

        const fetchNextRes = await executeQuery({
            app,
            query: gql`
                {
                    Sample__c(limit: 1, offset: 1, order_by: { Name: DESC }) {
                        Id
                        Name
                    }
                }
            `,
        });
        expect(fetchNextRes.data.Sample__c[0].Id).toBe(nextRecordId);
    });
});
