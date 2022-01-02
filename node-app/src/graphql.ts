import {
    GraphQLBoolean,
    GraphQLEnumType,
    GraphQLFieldConfig,
    GraphQLFieldResolver,
    GraphQLFloat,
    GraphQLID,
    GraphQLInputFieldConfig,
    GraphQLInputObjectType,
    GraphQLInt,
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
} from './entity.js';

declare module 'graphql' {
    interface GraphQLObjectTypeExtensions {
        sfdc?: Entity;
    }

    interface GraphQLFieldExtensions<_TSource, _TContext, _TArgs = any> {
        sfdc?: Field;
    }
}

interface SchemaConfig<Context> {
    entities: Entity[];
    resolvers?: {
        query?: (entity: Entity) => GraphQLFieldResolver<unknown, Context>;
        queryMany?: (entity: Entity) => GraphQLFieldResolver<unknown, Context>;
    };
}

interface State {
    config: SchemaConfig<any>;
    types: Map<string, GraphQLObjectType>;
    columnExprTypes: Map<string, GraphQLInputObjectType>;
    orderByTypes: Map<string, GraphQLList<GraphQLInputObjectType>>;
}

const SCALAR_TYPES_MAPPING: { [type in ScalarField['type']]: GraphQLScalarType } = {
    // Builtin GraphQL scalars
    [FieldType.ID]: GraphQLID,
    [FieldType.STRING]: GraphQLString,
    [FieldType.BOOLEAN]: GraphQLBoolean,
    [FieldType.INT]: GraphQLInt,
    [FieldType.FLOAT]: GraphQLFloat,

    // Custom SFDC types
    [FieldType.DATE]: new GraphQLScalarType({ name: 'Date' }),
    [FieldType.DATETIME]: new GraphQLScalarType({ name: 'DateTime' }),
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

const ORDER_BY_ENUM_TYPE_VALUES: { [name in GraphQLSortOrderValue]: {} } = {
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

    for (const entity of config.entities) {
        const type = createGraphQLEntityType(state, entity);
        state.types.set(entity.sfdcName, type);
    }

    const query = createQuery(state, config.entities);

    return new GraphQLSchema({
        query,
        types: Array.from(state.types.values()),
    });
}

function createGraphQLEntityType(state: State, entity: Entity): GraphQLObjectType {
    const { gqlName, fields } = entity;

    return new GraphQLObjectType({
        name: gqlName,
        fields: () => {
            return Object.fromEntries(
                fields.map((field) => [field.gqlName, createGraphQLEntityField(state, field)]),
            );
        },
        extensions: {
            sfdc: entity,
        },
    });
}

function createGraphQLEntityField(state: State, field: Field): GraphQLFieldConfig<any, unknown> {
    let type: GraphQLOutputType;
    let resolve: GraphQLFieldResolver<any, unknown> = (source) => {
        return source[field.sfdcName];
    };

    if (isScalarField(field)) {
        type = SCALAR_TYPES_MAPPING[field.type];
    } else if (isReferenceField(field)) {
        // If the the referenced entity is part of the graph, make the field resolve to the
        // associated GraphQL type. Otherwise make the field resolve object id.
        if (state.types.has(field.sfdcReferencedEntityName)) {
            type = state.types.get(field.sfdcReferencedEntityName)!;
            resolve = (source) => {
                return source[field.sfdcReferencedEntityName];
            };
        } else {
            // TODO: Add support for lookup that aren't part of the graph.
            type = GraphQLID;
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
        extensions: {
            sfdc: field,
        },
    };
}

function createQuery(state: State, entities: Entity[]): GraphQLObjectType {
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
    const { gqlName, sfdcName } = entity;
    const { resolvers } = state.config;

    const type = state.types.get(sfdcName)!;

    const orderByInputType = new GraphQLList(
        new GraphQLInputObjectType({
            name: `${sfdcName}OrderBy`,
            fields: Object.fromEntries(
                entity.fields
                    .filter((field) => field.config.sortable)
                    .map((field) => [
                        field.gqlName,
                        {
                            type: isReferenceField(field)
                                ? state.orderByTypes.get(field.sfdcReferencedEntityName) ??
                                  ORDER_BY_ENUM_TYPE
                                : ORDER_BY_ENUM_TYPE,
                        },
                    ]),
            ),
        }),
    );
    state.orderByTypes.set(sfdcName, orderByInputType);

    const columnExprInputType: GraphQLInputObjectType = new GraphQLInputObjectType({
        name: `${sfdcName}ColumnExpr`,
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
                        .map((field) => [
                            field.gqlName,
                            {
                                type: isReferenceField(field)
                                    ? state.columnExprTypes.get(field.sfdcReferencedEntityName) ??
                                      ORDER_BY_ENUM_TYPE
                                    : OPERATOR_INPUT_TYPES_MAPPING[field.type],
                            },
                        ]),
                ),
            };
        },
    });
    state.columnExprTypes.set(sfdcName, columnExprInputType);

    return {
        [gqlName]: {
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
            resolve: resolvers?.queryMany?.(entity),
        },
        [`${gqlName}_by_id`]: {
            args: BY_ID_INPUT_ARGS,
            type: type,
            resolve: resolvers?.query?.(entity),
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
    } else if (name === 'Text') {
        fields._like = { type };
    }

    return new GraphQLInputObjectType({
        name: `${name}Operator`,
        fields,
    });
}
