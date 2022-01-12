import {
    GraphQLBoolean,
    GraphQLEnumType,
    GraphQLFieldConfig,
    GraphQLFieldConfigArgumentMap,
    GraphQLFieldResolver,
    GraphQLFloat,
    GraphQLID,
    GraphQLInputFieldConfig,
    GraphQLInputObjectType,
    GraphQLInputType,
    GraphQLInt,
    GraphQLInterfaceType,
    GraphQLList,
    GraphQLNonNull,
    GraphQLObjectType,
    GraphQLOutputType,
    GraphQLScalarType,
    GraphQLSchema,
    GraphQLString,
} from 'graphql';

import {
    ChildRelationship,
    Entity,
    Field,
    FieldType,
    isPolymorphicReference,
    isReferenceField,
    isScalarField,
    ReferenceField,
    ScalarField,
    SfdcSchema,
} from './sfdc/schema.js';

interface SchemaConfig<Context> {
    sfdcSchema: SfdcSchema;
    resolvers?: {
        query?: (entity: Entity, schema: SfdcSchema) => GraphQLFieldResolver<unknown, Context>;
        queryMany?: (entity: Entity, schema: SfdcSchema) => GraphQLFieldResolver<unknown, Context>;
    };
}

interface State {
    config: SchemaConfig<any>;

    /** Map associating SObject names to GraphQL object types. */
    entityTypes: Map<string, GraphQLObjectType>;
    /** Map associating SObject names to GraphQL where predicate object types. */
    whereTypes: Map<string, GraphQLInputObjectType>;
    /** Map associating SObject names to GraphQL order by object types. */
    orderTypes: Map<string, GraphQLList<GraphQLInputObjectType>>;
}

const SCALAR_TYPES_MAPPING: { [type in ScalarField['type']]: GraphQLScalarType } = {
    // Builtin GraphQL scalars
    [FieldType.ID]: GraphQLID,
    [FieldType.STRING]: GraphQLString,
    [FieldType.BOOLEAN]: GraphQLBoolean,
    [FieldType.INT]: GraphQLInt,
    [FieldType.FLOAT]: GraphQLFloat,

    // Custom SFDC types
    [FieldType.ENCRYPTED_STRING]: new GraphQLScalarType({ name: 'EncryptedString' }),
    [FieldType.DATE]: new GraphQLScalarType({ name: 'Date' }),
    [FieldType.DATETIME]: new GraphQLScalarType({ name: 'DateTime' }),
    [FieldType.TIME]: new GraphQLScalarType({ name: 'Time' }),
    [FieldType.BASE64]: new GraphQLScalarType({ name: 'Base64' }),
    [FieldType.CURRENCY]: new GraphQLScalarType({ name: 'Currency' }),
    [FieldType.TEXTAREA]: new GraphQLScalarType({ name: 'TextArea' }),
    [FieldType.PERCENT]: new GraphQLScalarType({ name: 'Percent' }),
    [FieldType.PHONE]: new GraphQLScalarType({ name: 'Phone' }),
    [FieldType.URL]: new GraphQLScalarType({ name: 'URL' }),
    [FieldType.EMAIL]: new GraphQLScalarType({ name: 'Email' }),
    [FieldType.COMBOBOX]: new GraphQLScalarType({ name: 'Combobox' }),
    [FieldType.ANY_TYPE]: new GraphQLScalarType({ name: 'AnyType' }),
    [FieldType.PICKLIST]: new GraphQLScalarType({ name: 'Picklist' }),
    [FieldType.MULTI_PICKLIST]: new GraphQLScalarType({ name: 'MultiPicklist' }),
    [FieldType.ADDRESS]: new GraphQLScalarType({ name: 'Address' }),
    [FieldType.LOCATION]: new GraphQLScalarType({ name: 'Location' }),
};

const ENTITY_INTERFACE = new GraphQLInterfaceType({
    name: 'Entity',
    fields: {
        Id: {
            type: new GraphQLNonNull(GraphQLID),
        },
        Name: {
            type: GraphQLString,
        },
        CreatedDate: {
            type: new GraphQLNonNull(SCALAR_TYPES_MAPPING[FieldType.DATETIME]),
        },
        LastModifiedDate: {
            type: new GraphQLNonNull(SCALAR_TYPES_MAPPING[FieldType.DATETIME]),
        },
        SystemModstamp: {
            type: new GraphQLNonNull(SCALAR_TYPES_MAPPING[FieldType.DATETIME]),
        },
        LastViewedDate: {
            type: SCALAR_TYPES_MAPPING[FieldType.DATETIME],
        },
    },
});

const OPERATOR_INPUT_TYPES_MAPPING = Object.fromEntries(
    Object.entries(SCALAR_TYPES_MAPPING).map(([key, type]) => [key, createInputOperator({ type })]),
) as { [type in ScalarField['type']]: GraphQLInputObjectType };

export type GraphQLSortOrderValue =
    | 'ASC'
    | 'DESC'
    | 'ASC_NULLS_FIRST'
    | 'ASC_NULLS_LAST'
    | 'DESC_NULLS_FIRST'
    | 'DESC_NULLS_LAST';

const ORDER_BY_ENUM_TYPE_VALUES: { [name in GraphQLSortOrderValue]: object } = {
    ASC: {},
    DESC: {},
    ASC_NULLS_FIRST: {},
    ASC_NULLS_LAST: {},
    DESC_NULLS_FIRST: {},
    DESC_NULLS_LAST: {},
};

const ORDER_BY_ENUM_TYPE = new GraphQLEnumType({
    name: 'OrderByEnum',
    values: ORDER_BY_ENUM_TYPE_VALUES,
});

export function entitiesToSchema<Context>(config: SchemaConfig<Context>): GraphQLSchema {
    const state: State = {
        config,
        entityTypes: new Map(),
        orderTypes: new Map(),
        whereTypes: new Map(),
    };

    for (const [name, entity] of Object.entries(config.sfdcSchema.entities)) {
        const type = createGraphQLEntityType(state, entity);
        state.entityTypes.set(name, type);
    }

    const query = createQuery(state);

    return new GraphQLSchema({
        query,
        types: Array.from(state.entityTypes.values()),
    });
}

function createGraphQLEntityType(state: State, entity: Entity): GraphQLObjectType {
    const { name, fields, childRelationships } = entity;

    return new GraphQLObjectType({
        name,
        interfaces: [ENTITY_INTERFACE],
        fields: () => {
            const graphQLFields = fields.map((field) => [
                field.name,
                createGraphQLEntityField(state, field),
            ]);
            const graphQLRelationships = childRelationships
                .map((relationship) => [
                    relationship.name,
                    createGraphQLEntityRelationships(state, relationship),
                ])
                .filter(([, value]) => value !== undefined);

            return Object.fromEntries([...graphQLFields, ...graphQLRelationships]);
        },
    });
}

function createGraphQLEntityField(
    state: State,
    field: Field,
): GraphQLFieldConfig<unknown, unknown> {
    let type: GraphQLOutputType;
    let resolve: GraphQLFieldResolver<any, unknown> = (source) => {
        return source[field.name];
    };

    if (isScalarField(field)) {
        type = SCALAR_TYPES_MAPPING[field.type];
    } else if (isReferenceField(field)) {
        const { referencedEntity } = field;

        if (!referencedEntity) {
            type = GraphQLID;
        } else {
            type = state.entityTypes.get(referencedEntity.name)!;
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
    state: State,
    relationship: ChildRelationship,
): GraphQLFieldConfig<unknown, unknown> | undefined {
    const { entity } = relationship;

    // Ignore all the children relationships that aren't part of the SFDC graph. While it's possible
    // to produce all the children relationships, it would bloat the schema.
    if (!entity) {
        return;
    }

    const type = state.entityTypes.get(entity.name)!;
    const args = createEntityListArgs(state, entity);

    return {
        args,
        type: new GraphQLList(type),
    };
}

function createQuery(state: State): GraphQLObjectType {
    const { sfdcSchema } = state.config;
    const entities = Object.values(sfdcSchema.entities);

    return new GraphQLObjectType({
        name: 'Query',
        fields: () => {
            return Object.assign(
                {},
                ...entities.map((entity) => createEntityQueries(state, entity)),
            );
        },
    });
}

function createEntityQueries(
    state: State,
    entity: Entity,
): Record<string, GraphQLFieldConfig<unknown, unknown>> {
    const { name } = entity;
    const { resolvers, sfdcSchema } = state.config;

    const type = state.entityTypes.get(name)!;

    const queryManyArgs = createEntityListArgs(state, entity);
    const querySingleArgs = {
        id: {
            type: GraphQLID,
        },
    };

    return {
        [name]: {
            args: queryManyArgs,
            type: new GraphQLList(type),
            resolve: resolvers?.queryMany?.(entity, sfdcSchema),
        },
        [`${name}_by_id`]: {
            args: querySingleArgs,
            type: type,
            resolve: resolvers?.query?.(entity, sfdcSchema),
        },
    };
}

function createEntityListArgs(state: State, entity: Entity): GraphQLFieldConfigArgumentMap {
    const whereInputType = getWhereInputType(state, entity);
    const orderByInputType = getOderByInputType(state, entity);

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

function getOderByInputType(state: State, entity: Entity): GraphQLInputType {
    const { name, fields } = entity;
    let orderByInputType = state.orderTypes.get(name);

    if (orderByInputType === undefined) {
        orderByInputType = new GraphQLList(
            new GraphQLInputObjectType({
                name: `${name}OrderBy`,
                fields: () =>
                    Object.fromEntries(
                        fields
                            .filter((field) => field.config.sortable)
                            .map((field) => {
                                let type: GraphQLInputType = ORDER_BY_ENUM_TYPE;
                                if (isReferenceField(field) && field.referencedEntity) {
                                    type = getOderByInputType(state, field.referencedEntity);
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

        state.orderTypes.set(name, orderByInputType);
    }

    return orderByInputType;
}

function getWhereInputType(state: State, entity: Entity): GraphQLInputType {
    const { name, fields } = entity;
    let whereInputType = state.whereTypes.get(name);

    if (whereInputType === undefined) {
        // The type has to be explicitly set here to please TypeScript, otherwise it bails out
        // because of the recursive reference.
        const _whereInputType: GraphQLInputObjectType = new GraphQLInputObjectType({
            name: `${name}Where`,
            fields: () => {
                return {
                    _and: {
                        type: new GraphQLList(_whereInputType),
                    },
                    _or: {
                        type: new GraphQLList(_whereInputType),
                    },
                    ...Object.fromEntries(
                        fields
                            .filter(
                                (field): field is ScalarField | ReferenceField =>
                                    field.config.filterable && !isPolymorphicReference(field),
                            )
                            .map((field) => {
                                let type: GraphQLInputType;

                                if (isScalarField(field)) {
                                    type = OPERATOR_INPUT_TYPES_MAPPING[field.type];
                                } else if (isReferenceField(field)) {
                                    if (field.referencedEntity) {
                                        type = getWhereInputType(state, field.referencedEntity);
                                    } else {
                                        type = ORDER_BY_ENUM_TYPE;
                                    }
                                }

                                return [
                                    field.name,
                                    {
                                        type: type!,
                                    },
                                ];
                            }),
                    ),
                };
            },
        });

        whereInputType = _whereInputType;
        state.whereTypes.set(name, _whereInputType);
    }

    return whereInputType;
}

function createInputOperator({ type }: { type: GraphQLScalarType }): GraphQLInputObjectType {
    const { name } = type;
    const fields: Record<string, GraphQLInputFieldConfig> = {
        _eq: { type },
        _neq: { type },
        _gt: { type },
        _lt: { type },
        _gte: { type },
        _lte: { type },
        _in: { type: new GraphQLList(type) },
        _nin: { type: new GraphQLList(type) },
    };

    if (name === 'MultiPicklist') {
        fields._includes = { type };
        fields._excludes = { type };
    } else if (name === 'String') {
        fields._like = { type };
    }

    return new GraphQLInputObjectType({
        name: `${name}Operator`,
        fields,
    });
}
