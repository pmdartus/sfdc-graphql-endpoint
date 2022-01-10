import assert from 'node:assert';
import {
    GraphQLResolveInfo,
    Kind,
    GraphQLObjectType,
    GraphQLFieldResolver,
    SelectionSetNode,
    FieldNode,
    GraphQLSchema,
    isObjectType,
    valueFromAST,
    GraphQLField,
} from 'graphql';

import { GraphQLSortOrderValue } from './graphql.js';
import {
    Entity,
    isPolymorphicReference,
    isReferenceField,
    isScalarField,
} from './entity.js';

import { Api } from './sfdc/api.js';
import { Connection } from './sfdc/connection.js';
import {
    queryToString,
    SOQLComparisonOperator,
    SOQLConditionExpr,
    SOQLConditionExprType,
    SOQLFieldExpr,
    SoqlFieldType,
    SOQLLogicalOperator,
    SOQLOrderByItem,
    SOQLQuery,
    SOQLSelect,
    SOQLSortingOrder,
} from './sfdc/soql.js';

import { Logger } from './utils/logger.js';

export interface ResolverContext {
    connection: Connection;
    api: Api;
    logger?: Logger;
}

type SOQLQueryOptionals = Pick<SOQLQuery, 'where' | 'orderBy' | 'limit' | 'offset'>;

interface OrderByValue {
    [name: string]: GraphQLSortOrderValue | OrderByValue[];
}

type WhereValue =
    | { _and: WhereValue[] }
    | { _or: WhereValue[] }
    | {
          [name: string]: WhereValue | WhereFieldValue;
      };

interface WhereFieldValue {
    _eq?: unknown;
    _neq?: unknown;
    _gt?: unknown;
    _lt?: unknown;
    _gte?: unknown;
    _lte?: unknown;
    _in?: unknown;
    _nin?: unknown;
    _like?: unknown;
}

const GRAPHQL_SORTING_ORDER_SOQL_MAPPING: { [name in GraphQLSortOrderValue]: SOQLSortingOrder } = {
    ASC: SOQLSortingOrder.ASC,
    DESC: SOQLSortingOrder.DESC,
    ASC_NULLS_FIRST: SOQLSortingOrder.ASC_NULLS_FIRST,
    ASC_NULLS_LAST: SOQLSortingOrder.ASC_NULLS_LAST,
    DESC_NULLS_FIRST: SOQLSortingOrder.DESC_NULLS_FIRST,
    DESC_NULLS_LAST: SOQLSortingOrder.DESC_NULLS_LAST,
};

const GRAPHQL_COMP_OPERATOR_SOQL_MAPPING: {
    [name in Required<keyof WhereFieldValue>]: SOQLComparisonOperator;
} = {
    _eq: SOQLComparisonOperator.EQ,
    _neq: SOQLComparisonOperator.NEQ,
    _gt: SOQLComparisonOperator.GT,
    _gte: SOQLComparisonOperator.GTE,
    _lt: SOQLComparisonOperator.LT,
    _lte: SOQLComparisonOperator.LTE,
    _in: SOQLComparisonOperator.IN,
    _nin: SOQLComparisonOperator.NIN,
    _like: SOQLComparisonOperator.LIKE,
};

export const soqlResolvers = {
    query(entity: Entity): GraphQLFieldResolver<unknown, ResolverContext> {
        return async (_, args, context, info) => {
            const { api, logger } = context;

            const selects = resolveSelection(info, entity, info.fieldNodes[0].selectionSet!);

            const queryString = queryToString({
                selects,
                table: entity.name,
                where: {
                    type: SOQLConditionExprType.FIELD_EXPR,
                    field: 'Id',
                    operator: SOQLComparisonOperator.EQ,
                    value: args.id,
                },
            });

            logger?.debug(`Execute SOQL: ${queryString}`);
            const result = await api.executeSOQL(queryString);

            return result.records[0];
        };
    },
    queryMany(entity: Entity): GraphQLFieldResolver<unknown, ResolverContext> {
        return async (_, args, context, info) => {
            const { api, logger } = context;

            const fieldType = info.parentType.getFields()[info.fieldName];
            const fieldNode = info.fieldNodes.find((field) => field.name.value === info.fieldName)!;

            const selects = resolveSelection(info, entity, info.fieldNodes[0].selectionSet!);

            const soqlConfig = resolveQueryManyArgs(info, entity, fieldType, fieldNode);

            const query = queryToString({
                selects,
                table: entity.name,
                ...soqlConfig,
            });

            logger?.debug(`Execute SOQL: ${query}`);
            const result = await api.executeSOQL(query);

            return result.records;
        };
    },
};

function resolveQueryManyArgs(
    info: GraphQLResolveInfo,
    entity: Entity,
    fieldType: GraphQLField<unknown, ResolverContext>,
    fieldNode: FieldNode,
): SOQLQueryOptionals {
    const res: SOQLQueryOptionals = {};

    if (!fieldNode.arguments) {
        return res;
    }

    for (const argNode of fieldNode.arguments) {
        const argName = argNode.name.value;
        const argType = fieldType.args.find((argType) => argType.name === argName)!;

        const resolvedValue = valueFromAST(argNode.value, argType.type, info.variableValues);

        switch (argName) {
            case 'limit': {
                res.limit = resolvedValue as number;
                break;
            }

            case 'offset': {
                res.offset = resolvedValue as number;
                break;
            }

            case 'where': {
                res.where = resolveWhereExpr(info, entity, resolvedValue as WhereValue);
                break;
            }

            case 'order_by': {
                res.orderBy = resolveOrderBy(info, entity, resolvedValue as OrderByValue[]);
                break;
            }

            default:
                throw new Error(`Unknown argument name ${argName}`);
        }
    }

    return res;
}

function resolveWhereExpr(
    info: GraphQLResolveInfo,
    entity: Entity,
    whereValue: WhereValue,
    columnPrefix = '',
): SOQLConditionExpr | undefined {
    const { schema } = info;

    const combineConditionExprs = (
        exprs: SOQLConditionExpr[],
        operator: SOQLLogicalOperator,
    ): SOQLConditionExpr | undefined => {
        return exprs.reduceRight<SOQLConditionExpr | undefined>((acc, expr) => {
            if (expr === undefined) {
                return acc;
            } else {
                if (acc === undefined) {
                    return expr;
                } else {
                    return {
                        type: SOQLConditionExprType.LOGICAL_EXPR,
                        operator,
                        left: expr,
                        right: acc,
                    };
                }
            }
        }, undefined);
    };

    const resolveLogicalCondition = (
        values: WhereValue[],
        operator: SOQLLogicalOperator,
    ): SOQLConditionExpr | undefined => {
        const exprs = values
            .map((child) => resolveWhereExpr(info, entity, child))
            .filter((expr): expr is SOQLConditionExpr => expr !== undefined);

        return combineConditionExprs(exprs, operator);
    };

    if ('_and' in whereValue) {
        return resolveLogicalCondition(whereValue._and as WhereValue[], SOQLLogicalOperator.AND);
    } else if ('_or' in whereValue) {
        return resolveLogicalCondition(whereValue._or as WhereValue[], SOQLLogicalOperator.OR);
    } else {
        const exprs: SOQLConditionExpr[] = [];

        for (const [fieldName, fieldValue] of Object.entries(whereValue)) {
            const entityField = entity.fields.find((field) => field.name === fieldName);
            assert(entityField, `Can't find field ${fieldName} on ${entity.name}`);

            if (isScalarField(entityField)) {
                const soqlFieldExprs = Object.entries(fieldValue).map(
                    ([operationName, value]): SOQLFieldExpr => {
                        const operator =
                            GRAPHQL_COMP_OPERATOR_SOQL_MAPPING[
                                operationName as keyof WhereFieldValue
                            ];

                        return {
                            type: SOQLConditionExprType.FIELD_EXPR,
                            field: columnPrefix + entityField.name,
                            operator,
                            value,
                        };
                    },
                );
                exprs.push(...soqlFieldExprs);
            } else {
                if (isReferenceField(entityField)) {
                    const referencedEntity = getEntityByName(
                        schema,
                        entityField.sfdcReferencedEntityName,
                    )!;

                    const expr = resolveWhereExpr(
                        info,
                        referencedEntity,
                        fieldValue as WhereValue,
                        `${entityField.sfdcRelationshipName}.`,
                    );

                    if (expr) {
                        exprs.push(expr);
                    }
                } else {
                    // TODO: Handle polymorphic relationships.
                }
            }
        }

        return combineConditionExprs(exprs, SOQLLogicalOperator.AND);
    }
}

function resolveOrderBy(
    info: GraphQLResolveInfo,
    entity: Entity,
    orderByValues: OrderByValue[],
    columnPrefix = '',
): SOQLOrderByItem[] {
    const { schema } = info;

    return orderByValues.flatMap((orderByValue) =>
        Object.entries(orderByValue).flatMap(([fieldName, fieldValue]) => {
            const entityField = entity.fields.find((field) => field.name === fieldName);
            assert(entityField, `Can't find field ${fieldName} on ${entity.name}`);

            if (typeof fieldValue === 'string') {
                return {
                    field: columnPrefix + fieldName,
                    order: GRAPHQL_SORTING_ORDER_SOQL_MAPPING[fieldValue],
                };
            } else {
                if (isReferenceField(entityField)) {
                    const referencedEntity = getEntityByName(
                        schema,
                        entityField.sfdcReferencedEntityName,
                    )!;

                    return resolveOrderBy(info, referencedEntity, fieldValue, `${entityField.sfdcRelationshipName}.`);
                } else {
                    // TODO: Handle polymorphic relationships.
                    return [];
                }
            }
        }),
    );
}

function resolveSelection(
    info: GraphQLResolveInfo,
    entity: Entity,
    selectionSet: SelectionSetNode,
): SOQLSelect[] {
    const { schema, fragments } = info;
    const soqlSelects: SOQLSelect[] = [];

    for (const selection of selectionSet.selections) {
        switch (selection.kind) {
            case Kind.FIELD: {
                // Ignore meta fields.
                if (isMetaField(selection)) {
                    break;
                }

                const entityField = entity.fields.find(
                    (entity) => entity.name === selection.name.value,
                );
                assert(
                    entityField,
                    `Can't find field ${selection.name.value} on ${entity.name}`,
                );

                if (isScalarField(entityField)) {
                    soqlSelects.push({
                        type: SoqlFieldType.FIELD,
                        name: entityField.name,
                    });
                } else if (isReferenceField(entityField) && selection.selectionSet) {
                    const referenceEntity = getEntityByName(
                        schema,
                        entityField.sfdcReferencedEntityName,
                    )!;

                    soqlSelects.push({
                        type: SoqlFieldType.REFERENCE,
                        name: entityField.sfdcRelationshipName,
                        selects: resolveSelection(info, referenceEntity, selection.selectionSet),
                    });
                } else if (isPolymorphicReference(entityField) && selection.selectionSet) {
                    // TODO: Handle polymorphic relationships.
                }
                break;
            }

            case Kind.INLINE_FRAGMENT: {
                let fragmentEntity = entity;

                if (selection.typeCondition) {
                    const type = schema.getType(
                        selection.typeCondition.name.value,
                    ) as GraphQLObjectType;
                    fragmentEntity = type.extensions.sfdc!;
                }

                const fragmentSelects = resolveSelection(
                    info,
                    fragmentEntity,
                    selection.selectionSet,
                );
                soqlSelects.push(...fragmentSelects);
                break;
            }

            case Kind.FRAGMENT_SPREAD: {
                const fragment = fragments[selection.name.value];

                const type = schema.getType(fragment.typeCondition.name.value) as GraphQLObjectType;
                const fragmentEntity = type.extensions.sfdc!;

                const fragmentSelects = resolveSelection(
                    info,
                    fragmentEntity,
                    fragment.selectionSet,
                );
                soqlSelects.push(...fragmentSelects);
                break;
            }
        }
    }

    return soqlSelects;
}

function isMetaField(fieldNode: FieldNode): boolean {
    return fieldNode.name.value.startsWith('__');
}

// TODO: This is really under performant, and should be abstracted away. All the entities should be
// capable to reference each others.
function getEntityByName(schema: GraphQLSchema, name: string): Entity | undefined {
    return Object.values(schema.getTypeMap()).find(
        (type): type is GraphQLObjectType =>
            isObjectType(type) && type.extensions.sfdc?.name === name,
    )?.extensions.sfdc;
}
