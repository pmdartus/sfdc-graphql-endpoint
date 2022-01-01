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

import { Entity, Field, ScalarField } from './entity.js';

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

const SCALAR_TYPES: { [type in ScalarField['type']]: GraphQLScalarType } = {
    // Builtin GraphQL scalars
    id: GraphQLID,
    string: GraphQLString,
    boolean: GraphQLBoolean,
    int: GraphQLInt,
    double: GraphQLFloat,

    // Custom SFDC types
    date: new GraphQLScalarType({ name: 'Date' }),
    datetime: new GraphQLScalarType({ name: 'DateTime' }),
    base64: new GraphQLScalarType({ name: 'Base64' }),
    currency: new GraphQLScalarType({ name: 'Currency' }),
    textarea: new GraphQLScalarType({ name: 'TextArea' }),
    percent: new GraphQLScalarType({ name: 'Percent' }),
    phone: new GraphQLScalarType({ name: 'Phone' }),
    url: new GraphQLScalarType({ name: 'URL' }),
    email: new GraphQLScalarType({ name: 'Email' }),
    combobox: new GraphQLScalarType({ name: 'Combobox' }),
    anyType: new GraphQLScalarType({ name: 'AnyType' }),
    picklist: new GraphQLScalarType({ name: 'Picklist' }),
    multipicklist: new GraphQLScalarType({ name: 'MultiPicklist' }),
    address: new GraphQLScalarType({ name: 'Address' }),
    location: new GraphQLScalarType({ name: 'Location' }),
};

const OPERATOR_INPUT_TYPES = Object.fromEntries(
    Object.entries(SCALAR_TYPES).map(([key, type]) => [key, createInputOperator({ type })]),
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
}

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

    if (field.type !== 'reference') {
        type = SCALAR_TYPES[field.type];
    } else {
        const { referenceTo } = field;

        if (referenceTo.length === 1 && state.types.has(referenceTo[0])) {
            type = state.types.get(referenceTo[0])!;
            resolve = (source) => {
                return source[field.sfdcRelationshipName];
            };
        } else {
            type = GraphQLID;
        }
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
            let fields = {};

            for (const entity of entities) {
                fields = { ...fields, ...createEntityQueries(state, entity) };
            }

            return fields;
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
                            type:
                                field.type === 'reference'
                                    ? state.orderByTypes.get(field.referenceTo[0]) ??
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
                        .filter((field) => field.config.filterable)
                        .map((field) => [
                            field.gqlName,
                            {
                                type:
                                    field.type === 'reference'
                                        ? state.columnExprTypes.get(field.referenceTo[0]) ??
                                          ORDER_BY_ENUM_TYPE
                                        : OPERATOR_INPUT_TYPES[field.type],
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
