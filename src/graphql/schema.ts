import {
    GraphQLFieldConfig,
    GraphQLFieldConfigArgumentMap,
    GraphQLFieldResolver,
    GraphQLID,
    GraphQLInputObjectType,
    GraphQLInputType,
    GraphQLInt,
    GraphQLList,
    GraphQLNonNull,
    GraphQLObjectType,
    GraphQLOutputType,
    GraphQLSchema,
} from 'graphql';

import {
    ChildRelationship,
    Entity,
    Field,
    isPolymorphicReference,
    isReferenceField,
    isScalarField,
    ReferenceField,
    ScalarField,
    SfdcSchema,
} from '../sfdc/schema.js';

import { getScalarType, getScalarInputType, entityInterfaceType, orderByEnumType } from './types';

export interface Resolvers<ExecContext> {
    query?: (entity: Entity, schema: SfdcSchema) => GraphQLFieldResolver<unknown, ExecContext>;
    queryMany?: (entity: Entity, schema: SfdcSchema) => GraphQLFieldResolver<unknown, ExecContext>;
}

interface SchemaConfig<ExecContext> {
    sfdcSchema: SfdcSchema;
    resolvers?: Resolvers<ExecContext>;
}

interface SchemaGenerationContext {
    /** The Salesforce schema used to generate the GraphQL schema. */
    sfdcSchema: SfdcSchema;

    /** Map associating SObject names to GraphQL object types. */
    entityTypes: Map<string, GraphQLObjectType>;

    /** Map associating SObject names to GraphQL where predicate object types. */
    whereTypes: Map<string, GraphQLInputObjectType>;

    /** Map associating SObject names to GraphQL order by object types. */
    orderTypes: Map<string, GraphQLList<GraphQLInputObjectType>>;
}

export function entitiesToSchema<ExecContext>(config: SchemaConfig<ExecContext>): GraphQLSchema {
    const { sfdcSchema, resolvers = {} } = config;

    const ctx: SchemaGenerationContext = {
        sfdcSchema,
        entityTypes: new Map(),
        orderTypes: new Map(),
        whereTypes: new Map(),
    };

    for (const [name, entity] of Object.entries(sfdcSchema.entities)) {
        const type = createGraphQLEntityType(ctx, entity);
        ctx.entityTypes.set(name, type);
    }

    const query = createQuery(ctx, resolvers);

    return new GraphQLSchema({
        query,
        types: Array.from(ctx.entityTypes.values()),
    });
}

function createGraphQLEntityType(ctx: SchemaGenerationContext, entity: Entity): GraphQLObjectType {
    const { name, fields, childRelationships } = entity;

    return new GraphQLObjectType({
        name,
        interfaces: [entityInterfaceType],
        fields: () => {
            const graphQLFields = fields.map((field) => [
                field.name,
                createGraphQLEntityField(ctx, field),
            ]);
            const graphQLRelationships = childRelationships
                .map((relationship) => [
                    relationship.name,
                    createGraphQLEntityRelationships(ctx, relationship),
                ])
                .filter(([, value]) => value !== undefined);

            return Object.fromEntries([...graphQLFields, ...graphQLRelationships]);
        },
    });
}

function createGraphQLEntityField(
    ctx: SchemaGenerationContext,
    field: Field,
): GraphQLFieldConfig<unknown, unknown> {
    let type: GraphQLOutputType;
    let resolve: GraphQLFieldResolver<any, unknown> = (source) => {
        return source[field.name];
    };

    if (isScalarField(field)) {
        type = getScalarType(field.type);
    } else if (isReferenceField(field)) {
        const { referencedEntity } = field;

        if (!referencedEntity) {
            type = GraphQLID;
        } else {
            type = ctx.entityTypes.get(referencedEntity.name)!;
            resolve = (source) => {
                return source[field.relationshipName];
            };
        }
    } else {
        // TODO: Add support for polymorphic field lookups.
        type = GraphQLID;
    }

    if (!field.config.nillable) {
        type = new GraphQLNonNull(type);
    }

    return {
        type,
        resolve,
    };
}

function createGraphQLEntityRelationships(
    ctx: SchemaGenerationContext,
    relationship: ChildRelationship,
): GraphQLFieldConfig<unknown, unknown> | undefined {
    const { entity } = relationship;

    // Ignore all the children relationships that aren't part of the SFDC graph. While it's possible
    // to produce all the children relationships, it would bloat the schema.
    if (!entity) {
        return;
    }

    const type = ctx.entityTypes.get(entity.name)!;
    const args = createEntityListArgs(ctx, entity);

    return {
        args,
        type: new GraphQLList(type),
    };
}

function createQuery<ExecContext>(
    ctx: SchemaGenerationContext,
    resolvers: Resolvers<ExecContext>,
): GraphQLObjectType {
    const { sfdcSchema } = ctx;
    const entities = Object.values(sfdcSchema.entities);

    return new GraphQLObjectType({
        name: 'Query',
        fields: () => {
            return Object.assign(
                {},
                ...entities.map((entity) => createEntityQueries(ctx, entity, resolvers)),
            );
        },
    });
}

function createEntityQueries<ExecContext>(
    ctx: SchemaGenerationContext,
    entity: Entity,
    resolvers: Resolvers<ExecContext>,
): Record<string, GraphQLFieldConfig<unknown, ExecContext>> {
    const { name } = entity;
    const { sfdcSchema } = ctx;

    const type = ctx.entityTypes.get(name)!;

    const queryManyArgs = createEntityListArgs(ctx, entity);
    const querySingleArgs = {
        id: {
            type: GraphQLID,
        },
    };

    return {
        [name]: {
            args: queryManyArgs,
            type: new GraphQLList(type),
            resolve: resolvers.queryMany?.(entity, sfdcSchema),
        },
        [`${name}_by_id`]: {
            args: querySingleArgs,
            type: type,
            resolve: resolvers.query?.(entity, sfdcSchema),
        },
    };
}

function createEntityListArgs(
    ctx: SchemaGenerationContext,
    entity: Entity,
): GraphQLFieldConfigArgumentMap {
    const whereInputType = getWhereInputType(ctx, entity);
    const orderByInputType = getOderByInputType(ctx, entity);

    return {
        limit: {
            type: new GraphQLNonNull(GraphQLInt),
        },
        offset: {
            type: GraphQLInt,
        },
        where: {
            type: whereInputType,
        },
        order_by: {
            type: orderByInputType,
        },
    };
}

function getOderByInputType(ctx: SchemaGenerationContext, entity: Entity): GraphQLInputType {
    const { name, fields } = entity;
    let orderByInputType = ctx.orderTypes.get(name);

    if (orderByInputType === undefined) {
        orderByInputType = new GraphQLList(
            new GraphQLInputObjectType({
                name: `${name}OrderBy`,
                fields: () =>
                    Object.fromEntries(
                        fields
                            .filter((field) => field.config.sortable)
                            .map((field) => {
                                let type: GraphQLInputType = orderByEnumType;
                                if (isReferenceField(field) && field.referencedEntity) {
                                    type = getOderByInputType(ctx, field.referencedEntity);
                                }

                                return [
                                    field.name,
                                    {
                                        type,
                                    },
                                ];
                            }),
                    ),
            }),
        );

        ctx.orderTypes.set(name, orderByInputType);
    }

    return orderByInputType;
}

function getWhereInputType(ctx: SchemaGenerationContext, entity: Entity): GraphQLInputType {
    const { name, fields } = entity;
    let whereInputType = ctx.whereTypes.get(name);

    if (whereInputType === undefined) {
        // The type has to be explicitly set here to please TypeScript, otherwise it bails out
        // because of the recursive reference.
        const _whereInputType: GraphQLInputObjectType = new GraphQLInputObjectType({
            name: `${name}Where`,
            fields: () => {
                // TODO: Add support for polymorphic fields.
                const filterableFields = fields.filter(
                    (field): field is ScalarField | ReferenceField =>
                        field.config.filterable && !isPolymorphicReference(field),
                );

                const fieldsPredicates = Object.fromEntries(
                    filterableFields.map((field) => {
                        let type: GraphQLInputType;

                        if (isScalarField(field)) {
                            type = getScalarInputType(field.type);
                        } else if (isReferenceField(field)) {
                            if (field.referencedEntity) {
                                type = getWhereInputType(ctx, field.referencedEntity);
                            } else {
                                type = orderByEnumType;
                            }
                        }

                        return [
                            field.name,
                            {
                                type: type!,
                            },
                        ];
                    }),
                );

                return {
                    _and: {
                        type: new GraphQLList(_whereInputType),
                    },
                    _or: {
                        type: new GraphQLList(_whereInputType),
                    },
                    ...fieldsPredicates,
                };
            },
        });

        whereInputType = _whereInputType;
        ctx.whereTypes.set(name, _whereInputType);
    }

    return whereInputType;
}
