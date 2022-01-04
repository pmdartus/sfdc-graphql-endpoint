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
                        Product__c(order_by: { price__c: DESC }, limit: 4) {
                            name
                            price__c
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
                        Product__c(order_by: { gender__c: ASC, price__c: ASC }, limit: 10) {
                            name
                            price__c
                            gender__c
                        }
                    }
                `,
            });
            expect(data).toMatchSnapshot();
        });

        test('retrieve more products', async () => {
            const query = gql`
                query getProducts($offset: Int = 0) {
                    Product__c(order_by: { price__c: DESC }, limit: 2, offset: $offset) {
                        name
                        price__c
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
                            where: { suspension__c: { _eq: true } }
                            order_by: { name: ASC }
                            limit: 10
                        ) {
                            name
                            price__c
                            suspension__c
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
                            where: { price__c: { _gt: 1300, _lt: 1500 } }
                            order_by: { name: ASC }
                            limit: 10
                        ) {
                            name
                            price__c
                        }
                    }
                `,
            });
            expect(data).toMatchSnapshot();
        });

        test('retrieve products by exact name', async () => {
            const { data } = await executeQuery({
                app,
                query: gql`
                    {
                        Product__c(
                            where: { name: { _eq: "Neomov - Basic" } }
                            order_by: { name: ASC }
                            limit: 10
                        ) {
                            name
                            price__c
                        }
                    }
                `,
            });
            expect(data).toMatchSnapshot();
        });

        test('retrieve products by matching name', async () => {
            const { data } = await executeQuery({
                app,
                query: gql`
                    {
                        Product__c(
                            where: { name: { _like: "Neomov%" } }
                            order_by: { name: ASC }
                            limit: 10
                        ) {
                            name
                            price__c
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
                            where: { gender__c: { _in: ["Male", "Female"] } }
                            order_by: { name: ASC }
                            limit: 10
                        ) {
                            name
                            price__c
                            gender__c
                        }
                    }
                `,
            });
            expect(data).toMatchSnapshot();
        });

        test('retrieve the products with the "Rolling Mountain" family name', async () => {
            const { data } = await executeQuery({
                app,
                query: gql`
                    {
                        Product__c(
                            where: { product_Family__r: { name: { _eq: "Rolling Mountain" } } }
                            order_by: { name: ASC }
                            limit: 10
                        ) {
                            name
                            price__c
                            product_Family__r {
                                name
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
                            id
                            name
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
                            id
                            name
                        }
                    }
                `,
                variables: {
                    id: productList[0].id,
                },
            });

            expect(product).toEqual(productList[0]);
        });
    });
});
