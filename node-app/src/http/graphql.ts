import * as graphql from 'graphql';
import { GraphQLSchema, Source, DocumentNode } from 'graphql';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { createEntity } from '../entity.js';
import { entitiesToSchema } from '../graphql.js';
import { soqlResolvers, ResolverContext } from '../resolvers.js';

import { LRU } from '../utils/lru.js';
import { Api } from '../sfdc/api.js';

import sfdcFastifyPlugin from './sfdc-plugin.js';

const ENTITIES = ['Account', 'User', 'Lead', 'Opportunity'];

interface GraphQLQueryString {
    query?: string;
    variables?: string;
    operationName?: string;
}

interface GraphQLParams {
    query?: string;
    variables?: Record<string, unknown>;
    operationName?: string;
}

export async function graphqlFastifyPlugin(fastify: FastifyInstance) {
    let schema: GraphQLSchema | undefined;
    const queryCache = new LRU<string, DocumentNode>(100);

    fastify.register(sfdcFastifyPlugin);

    fastify.get<{
        Params: GraphQLQueryString;
    }>('/graphql', async (request, response) => {
        if (request.headers.accept?.includes('text/html')) {
            return respondWithGraphIql(response);
        }

        let variables;
        try {
            variables = request.params.variables ? JSON.parse(request.params.variables) : {};
        } catch (error) {
            throw {
                statusCode: 400,
                message: 'Invalid GraphQL query.',
                errors: ['Failed to parse variables'],
            };
        }

        return executeQuery(request, response, {
            ...request.params,
            variables,
        });
    });

    fastify.post<{
        Body: GraphQLParams;
    }>('/graphql', async (request, response) => {
        return executeQuery(request, response, {
            ...request.body,
        });
    });

    async function executeQuery(
        request: FastifyRequest,
        response: FastifyReply,
        params: GraphQLParams,
    ): Promise<graphql.ExecutionResult> {
        const { api, connection } = fastify.sfdc;
        const { query, variables, operationName } = params;

        if (!schema) {
            request.log.info('Fetching graphQL schema');
            schema = await buildSchema(api);
        }

        if (!query) {
            throw {
                statusCode: 400,
                message: 'Invalid GraphQL query.',
                errors: ['Missing query body'],
            };
        }

        const queryDocumentAst = parseAndValidateQuery(schema, query);
        const context: ResolverContext = {
            api,
            connection,
            logger: request.log
        };

        let result: graphql.ExecutionResult;
        try {
            result = await graphql.execute({
                schema,
                operationName,
                variableValues: variables,
                document: queryDocumentAst,
                contextValue: context,
            });
        } catch (error: unknown) {
            throw {
                statusCode: 400,
                message: 'GraphQL execution error.',
                graphqlErrors: [error]
            }
        }

        return result;
    }

    async function buildSchema(api: Api): Promise<GraphQLSchema> {
        const sObjects = await Promise.all(ENTITIES.map((entity) => api.describeSObject(entity)));
    
        const schema = entitiesToSchema({
            entities: sObjects.map(sObject => createEntity(sObject)),
            resolvers: soqlResolvers,
        });
    
        graphql.assertValidSchema(schema);
    
        return schema;
    }

    function parseAndValidateQuery(schema: GraphQLSchema, query: string): DocumentNode {
        let documentAst = queryCache.get(query);

        if (documentAst === null) {
            try {
                documentAst = graphql.parse(new Source(query));
            } catch (err: unknown) {
                throw { statusCode: 400, message: 'GraphQL syntax error.', errors: [err] };
            }

            const validationErrors = graphql.validate(schema, documentAst);
            if (validationErrors.length > 0) {
                throw {
                    statusCode: 400,
                    message: 'Invalid GraphQL query.',
                    errors: validationErrors,
                };
            }

            queryCache.set(query, documentAst);
        }

        return documentAst;
    }
}

function respondWithGraphIql(response: FastifyReply) {
    response.type('text/html').send(`
        <html>
            <head>
                <title>Simple GraphiQL Example</title>
                <link href="https://unpkg.com/graphiql/graphiql.min.css" rel="stylesheet" />
            </head>
            <body style="margin: 0;">
                <div id="graphiql" style="height: 100vh;"></div>

                <script
                    crossorigin
                    src="https://unpkg.com/react/umd/react.production.min.js"
                ></script>
                <script
                    crossorigin
                    src="https://unpkg.com/react-dom/umd/react-dom.production.min.js"
                ></script>
                <script
                    crossorigin
                    src="https://unpkg.com/graphiql/graphiql.min.js"
                ></script>

                <script>
                    const fetcher = GraphiQL.createFetcher({ url: '/graphql' });

                    ReactDOM.render(
                        React.createElement(GraphiQL, { fetcher: fetcher }),
                        document.getElementById('graphiql'),
                    );
                </script>
            </body>
        </html>
    `);
}
