import { FastifyInstance } from 'fastify';
import { buildClientSchema, getIntrospectionQuery, printSchema } from 'graphql';

import { gql, getApp, executeQuery } from './utils.js';

let app: FastifyInstance;
beforeAll(() => {
    app = getApp({
        entities: ['Product__c', 'Product_Family__c', 'Order_Item__c', 'Order__c'],
    });
});

describe('eBikes entity', () => {
    describe('introspection', () => {
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
    });

    describe('get product list', () => {
        test('retrieve most expensive products', async () => {
            const { data } = await executeQuery({
                app,
                query: gql`
                    {
                        Product__c(order_by: { Price__c: DESC }, limit: 4) {
                            Name
                            Price__c
                        }
                    }
                `,
            });
            expect(data).toMatchSnapshot();
        });

        test('retrieve products order by gender and price', async () => {
            const { data } = await executeQuery({
                app,
                query: gql`
                    {
                        Product__c(order_by: { Gender__c: ASC, Price__c: ASC }, limit: 10) {
                            Name
                            Price__c
                            Gender__c
                        }
                    }
                `,
            });
            expect(data).toMatchSnapshot();
        });

        test('retrieve more products', async () => {
            const query = gql`
                query getProducts($offset: Int = 0) {
                    Product__c(order_by: { Price__c: DESC }, limit: 2, offset: $offset) {
                        Name
                        Price__c
                    }
                }
            `;

            const { data: initialProducts } = await executeQuery({
                app,
                query,
                variables: {
                    offset: 0,
                },
            });
            expect(initialProducts).toMatchSnapshot();

            const { data: moreProducts } = await executeQuery({
                app,
                query,
                variables: {
                    offset: 2,
                },
            });
            expect(moreProducts).toMatchSnapshot();
        });

        test('retrieve the products with suspensions', async () => {
            const { data } = await executeQuery({
                app,
                query: gql`
                    {
                        Product__c(
                            where: { Suspension__c: { _eq: true } }
                            order_by: { Name: ASC }
                            limit: 10
                        ) {
                            Name
                            Price__c
                            Suspension__c
                        }
                    }
                `,
            });
            expect(data).toMatchSnapshot();
        });

        test('retrieve products in price range', async () => {
            const { data } = await executeQuery({
                app,
                query: gql`
                    {
                        Product__c(
                            where: { Price__c: { _gt: 1300, _lt: 1500 } }
                            order_by: { Name: ASC }
                            limit: 10
                        ) {
                            Name
                            Price__c
                        }
                    }
                `,
            });
            expect(data).toMatchSnapshot();
        });

        test('retrieve products by exact Name', async () => {
            const { data } = await executeQuery({
                app,
                query: gql`
                    {
                        Product__c(
                            where: { Name: { _eq: "Neomov - Basic" } }
                            order_by: { Name: ASC }
                            limit: 10
                        ) {
                            Name
                            Price__c
                        }
                    }
                `,
            });
            expect(data).toMatchSnapshot();
        });

        test('retrieve products by matching Name', async () => {
            const { data } = await executeQuery({
                app,
                query: gql`
                    {
                        Product__c(
                            where: { Name: { _like: "Neomov%" } }
                            order_by: { Name: ASC }
                            limit: 10
                        ) {
                            Name
                            Price__c
                        }
                    }
                `,
            });
            expect(data).toMatchSnapshot();
        });

        test('retrieve products male or female products only', async () => {
            const { data } = await executeQuery({
                app,
                query: gql`
                    {
                        Product__c(
                            where: { Gender__c: { _in: ["Male", "Female"] } }
                            order_by: { Name: ASC }
                            limit: 10
                        ) {
                            Name
                            Price__c
                            Gender__c
                        }
                    }
                `,
            });
            expect(data).toMatchSnapshot();
        });

        test('retrieve the products with the "Rolling Mountain" family Name', async () => {
            const { data } = await executeQuery({
                app,
                query: gql`
                    {
                        Product__c(
                            where: { Product_Family__c: { Name: { _eq: "Rolling Mountain" } } }
                            order_by: { Name: ASC }
                            limit: 10
                        ) {
                            Name
                            Price__c
                            Product_Family__c {
                                Name
                            }
                        }
                    }
                `,
            });
            expect(data).toMatchSnapshot();
        });
    });

    describe('get single product', () => {
        test('retrieve a specific product by id', async () => {
            const {
                data: { Product__c: productList },
            } = await executeQuery({
                app,
                query: gql`
                    {
                        Product__c(limit: 1) {
                            Id
                            Name
                        }
                    }
                `,
            });
            const {
                data: { Product__c_by_id: product },
            } = await executeQuery({
                app,
                query: gql`
                    query getProductById($id: ID!) {
                        Product__c_by_id(id: $id) {
                            Id
                            Name
                        }
                    }
                `,
                variables: {
                    id: productList[0].Id,
                },
            });

            expect(product).toEqual(productList[0]);
        });
    });

    describe('get orders', () => {
        test('retrieve products associated with order items', async () => {
            const { data } = await executeQuery({
                app,
                query: gql`
                    {
                        Order__c(limit: 10) {
                            Order_Items__r(limit: 10, order_by: { Name: DESC }) {
                                Product__c {
                                    Name
                                    Price__c
                                }
                            }
                        }
                    }
                `,
            });
            expect(data).toMatchSnapshot();
        });
    });

    describe('SOQL query explanation', () => {
        test('Setting the "X-Explain-SOQL" should return planning explanation', async () => {
            const res = await executeQuery({
                app,
                query: gql`
                    {
                        Product__c(order_by: { Price__c: DESC }, limit: 4) {
                            Name
                            Price__c
                        }
                    }
                `,
                headers: {
                    'X-Explain-SOQL': 'true',
                }
            });

            expect(Array.isArray(res.data.Product__c)).toBe(true);
            expect(res.extensions).toMatchObject({
                explain: {
                    plans: expect.any(Array),
                    sourceQuery: expect.any(String),
                }
            })
        });
    });
});
