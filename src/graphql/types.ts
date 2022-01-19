import {
    GraphQLBoolean,
    GraphQLEnumType,
    GraphQLEnumValueConfig,
    GraphQLFloat,
    GraphQLID,
    GraphQLInputFieldConfig,
    GraphQLInputObjectType,
    GraphQLInputType,
    GraphQLInt,
    GraphQLInterfaceType,
    GraphQLList,
    GraphQLNonNull,
    GraphQLScalarType,
    GraphQLString,
} from 'graphql';

import { FieldType, ScalarField } from '../sfdc/schema.js';

/**
 * Mapping associating Salesforce fields types with GraphQL scalars. GraphQL supports out of the 
 * box a limit set of scalars (eg. ID, String). Custom scalars are used to represent more complex 
 * fields (eg. date time, location).
 */
const SCALAR_TYPES: { [type in ScalarField['type']]: GraphQLScalarType } = {
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

/**
 * Mapping associating Salesforce field types to GraphQL input types. Query capabilities depends on 
 * the field type.
 */
const SCALAR_INPUT_TYPES = Object.fromEntries(
    Object.entries(SCALAR_TYPES).map(([key, type]) => {
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

        return [
            key,
            new GraphQLInputObjectType({
                name: `${name}Operator`,
                fields,
            }),
        ];
    }),
) as { [type in ScalarField['type']]: GraphQLInputObjectType };

/** 
 * A GraphQL interface implemented by all SObjects. This interface includes fields like Id, Name or
 * CreatedDate. Those fields are present on all standard Salesforce object and are automatically
 * created on all new SObjects.
 */
export const entityInterfaceType = new GraphQLInterfaceType({
    name: 'Entity',
    fields: {
        Id: {
            type: new GraphQLNonNull(GraphQLID),
        },
        Name: {
            type: GraphQLString,
        },
        CreatedDate: {
            type: new GraphQLNonNull(SCALAR_TYPES[FieldType.DATETIME]),
        },
        LastModifiedDate: {
            type: new GraphQLNonNull(SCALAR_TYPES[FieldType.DATETIME]),
        },
        SystemModstamp: {
            type: new GraphQLNonNull(SCALAR_TYPES[FieldType.DATETIME]),
        },
    },
});

export type GraphQLSortOrderValue =
    | 'ASC'
    | 'DESC'
    | 'ASC_NULLS_FIRST'
    | 'ASC_NULLS_LAST'
    | 'DESC_NULLS_FIRST'
    | 'DESC_NULLS_LAST';

const ORDER_BY_ENUM_TYPE_VALUES: { [name in GraphQLSortOrderValue]: GraphQLEnumValueConfig } = {
    ASC: {},
    DESC: {},
    ASC_NULLS_FIRST: {},
    ASC_NULLS_LAST: {},
    DESC_NULLS_FIRST: {},
    DESC_NULLS_LAST: {},
};

export const orderByEnumType = new GraphQLEnumType({
    name: 'OrderByEnum',
    values: ORDER_BY_ENUM_TYPE_VALUES,
});

/** 
 * Given a Salesforce scalar field type, return its mapping GraphQL scalar type. 
 */
export function getScalarType(fieldType: ScalarField['type']): GraphQLScalarType {
    return SCALAR_TYPES[fieldType];
}

/** 
 * Given a Salesforce scalar field type, return its mapping GraphQL input scalar type.
 */
export function getScalarInputType(fieldType: ScalarField['type']): GraphQLInputType {
    return SCALAR_INPUT_TYPES[fieldType];
}
