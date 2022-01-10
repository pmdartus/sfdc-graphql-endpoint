import {
    GraphQLBoolean,
    GraphQLEnumType,
    GraphQLFieldConfig,
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
    types: Map<string, GraphQLObjectType>;
    columnExprTypes: Map<string, GraphQLInputObjectType>;
    orderByTypes: Map<string, GraphQLList<GraphQLInputObjectType>>;
}

const ENTITY_INTERFACE = new GraphQLInterfaceType({
    name: 'Entity',
    fields: {
        Id: {
            type: GraphQLID,
        },
        Name: {
            type: GraphQLString,
        },
    },
});

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

const OPERATOR_INPUT_TYPES_MAPPING = Object.fromEntries(
    Object.entries(SCALAR_TYPES_MAPPING).map(([key, type]) => [key, createInputOperator({ type })]),
) as { [type in ScalarField['type']]: GraphQLInputObjectType };

const BY_ID_INPUT_ARGS = {
    id: {
        type: GraphQLID,
    },
};

const PAGINATION_INPUT_ARGS = {
    limit: {
        type: new GraphQLNonNull(GraphQLInt),
    },
    offset: {
        type: GraphQLInt,
    },
};

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
        types: new Map(),
        orderByTypes: new Map(),
        columnExprTypes: new Map(),
    };

    for (const [name, entity] of Object.entries(config.sfdcSchema.entities)) {
        const type = createGraphQLEntityType(state, entity);
        state.types.set(name, type);
    }

    const query = createQuery(state);

    return new GraphQLSchema({
        query,
        types: Array.from(state.types.values()),
    });
}

function createGraphQLEntityType(state: State, entity: Entity): GraphQLObjectType {
    const { name, fields } = entity;

    return new GraphQLObjectType({
        name,
        fields: () => {
            return Object.fromEntries(
                fields.map((field) => [field.name, createGraphQLEntityField(state, field)]),
            );
        },
        interfaces: [ENTITY_INTERFACE],
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
            type = state.types.get(referencedEntity.name)!;
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

    const type = state.types.get(name)!;

    const orderByInputType = new GraphQLList(
        new GraphQLInputObjectType({
            name: `${name}OrderBy`,
            fields: () => Object.fromEntries(
                entity.fields
                    .filter((field) => field.config.sortable)
                    .map((field) => {
                        let type: GraphQLInputType = ORDER_BY_ENUM_TYPE;
                        if (isReferenceField(field) && field.referencedEntity) {
                            type = state.orderByTypes.get(field.referencedEntity.name)!;
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
    state.orderByTypes.set(name, orderByInputType);

    const columnExprInputType: GraphQLInputObjectType = new GraphQLInputObjectType({
        name: `${name}ColumnExpr`,
        fields: () => {
            return {
                _and: {
                    type: new GraphQLList(columnExprInputType),
                },
                _or: {
                    type: new GraphQLList(columnExprInputType),
                },
                ...Object.fromEntries(
                    entity.fields
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
                                    type = state.columnExprTypes.get(field.referencedEntity.name)!;
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
    state.columnExprTypes.set(name, columnExprInputType);

    return {
        [name]: {
            args: {
                ...PAGINATION_INPUT_ARGS,
                where: {
                    type: columnExprInputType,
                },
                order_by: {
                    type: orderByInputType,
                },
            },
            type: new GraphQLList(type),
            resolve: resolvers?.queryMany?.(entity, sfdcSchema),
        },
        [`${name}_by_id`]: {
            args: BY_ID_INPUT_ARGS,
            type: type,
            resolve: resolvers?.query?.(entity, sfdcSchema),
        },
    };
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
