import * as graphql from 'graphql';
import { GraphQLSchema, Source, DocumentNode } from 'graphql';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { entitiesToSchema } from '../graphql/schema.js';
import { resolvers, ResolverContext } from '../graphql/resolvers.js';

import { Api } from '../sfdc/api.js';
import { createSfdcSchema } from '../sfdc/schema.js';

import { LRU } from '../utils/lru.js';

import sfdcFastifyPlugin from './sfdc-plugin.js';

export interface SfdcGraphQLOptions {
    entities: string[],
    instanceUrl: string,
    accessToken: string,
}

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

export function graphqlFastifyPlugin(opts: SfdcGraphQLOptions) {
    const { entities, instanceUrl, accessToken } = opts;

    return async (fastify: FastifyInstance) => {
        let schema: GraphQLSchema | undefined;
        const queryCache = new LRU<string, DocumentNode>(100);
    
        fastify.register(sfdcFastifyPlugin, {
            instanceUrl,
            accessToken
        });
    
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
            const { api } = fastify.sfdc;
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

                if (context.soqlQuery) {
                    fastify.log.debug('Executing SOQL query:', context.soqlQuery);

                    if (request.headers['x-explain-soql']) {
                        const explain = await api.explainSOQL(context.soqlQuery);
                        result = {
                            ...result,
                            extensions: {
                                explain,
                            }
                        }
                    }
                }
            } catch (error: unknown) {
                throw {
                    statusCode: 400,
                    message: 'GraphQL execution error.',
                    graphqlErrors: [error],
                };
            }

            return result;
        }
    
        async function buildSchema(api: Api): Promise<GraphQLSchema> {
            const sObjects = await Promise.all(entities.map((entity) => api.describeSObject(entity)));

            const schema = entitiesToSchema({
                sfdcSchema: createSfdcSchema({ sObjects }),
                resolvers,
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
