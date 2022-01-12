import assert from 'node:assert';
import {
    GraphQLResolveInfo,
    Kind,
    GraphQLFieldResolver,
    SelectionSetNode,
    FieldNode,
    valueFromAST,
    GraphQLField,
    GraphQLObjectType,
    assertObjectType,
    FragmentSpreadNode,
    InlineFragmentNode,
} from 'graphql';

import { GraphQLSortOrderValue } from './graphql.js';

import { Api } from './sfdc/api.js';
import { Connection } from './sfdc/connection.js';
import {
    Entity,
    isPolymorphicReference,
    isReferenceField,
    isScalarField,
    SfdcSchema,
} from './sfdc/schema.js';
import {
    queryToString,
    SOQLComparisonOperator,
    SOQLConditionExpr,
    SOQLConditionExprType,
    SOQLFieldExpr,
    SOQLFieldType,
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
    query(entity: Entity, sfdcSchema: SfdcSchema): GraphQLFieldResolver<unknown, ResolverContext> {
        return async (_, args, context, info) => {
            const { api, logger } = context;
            const objectType = info.parentType;

            const selects = resolveSelection(
                info,
                entity,
                objectType,
                sfdcSchema,
                info.fieldNodes[0].selectionSet!,
            );

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
    queryMany(
        entity: Entity,
        sfdcSchema: SfdcSchema,
    ): GraphQLFieldResolver<unknown, ResolverContext> {
        return async (_, args, context, info) => {
            try {
                const { api, logger } = context;
                const objectType = info.parentType;

                const fieldType = objectType.getFields()[info.fieldName];
                const fieldNode = info.fieldNodes.find(
                    (field) => field.name.value === info.fieldName,
                )!;

                const selects = resolveSelection(
                    info,
                    entity,
                    objectType,
                    sfdcSchema,
                    info.fieldNodes[0].selectionSet!,
                );

                const soqlArgs = resolveQueryManyArgs(info, entity, fieldType, fieldNode);

                const query = queryToString({
                    selects,
                    table: entity.name,
                    ...soqlArgs,
                });

                logger?.debug(`Execute SOQL: ${query}`);
                const result = await api.executeSOQL(query);

                return result.records;
            } catch (error) {
                console.error(error);
            }
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
                assert.fail(`Unknown argument name ${argName}`);
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
            const entityRelationship = entity.childRelationships.find(
                (relation) => relation.name === fieldName,
            );

            if (entityField) {
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
                        const expr = resolveWhereExpr(
                            info,
                            entityField.referencedEntity!,
                            fieldValue as WhereValue,
                            `${entityField.relationshipName}.`,
                        );

                        if (expr) {
                            exprs.push(expr);
                        }
                    } else {
                        // TODO: Handle polymorphic relationships.
                    }
                }
            } else if (entityRelationship) {
                console.log(entityRelationship);
            } else {
                assert.fail(
                    `Can't find field or relationship named "${fieldName}" on "${entity.name}"`,
                );
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
                    return resolveOrderBy(
                        info,
                        entityField.referencedEntity!,
                        fieldValue,
                        `${entityField.relationshipName}.`,
                    );
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
    objectType: GraphQLObjectType,
    sfdcSchema: SfdcSchema,
    selectionSet: SelectionSetNode,
): SOQLSelect[] {
    const soqlSelects: SOQLSelect[] = [];

    for (const selection of selectionSet.selections) {
        switch (selection.kind) {
            case Kind.FIELD: {
                const select = resolveFieldSelection(
                    info,
                    entity,
                    objectType,
                    sfdcSchema,
                    selection,
                );

                if (select !== undefined) {
                    soqlSelects.push(select);
                }
                break;
            }

            case Kind.INLINE_FRAGMENT: {
                soqlSelects.push(
                    ...resolveInlineFragmentSelection(
                        info,
                        entity,
                        objectType,
                        sfdcSchema,
                        selection,
                    ),
                );
                break;
            }

            case Kind.FRAGMENT_SPREAD: {
                soqlSelects.push(...resolveFragmentSelection(info, sfdcSchema, selection));
                break;
            }
        }
    }

    return soqlSelects;
}

function resolveFieldSelection(
    info: GraphQLResolveInfo,
    entity: Entity,
    objectType: GraphQLObjectType<any, any>,
    sfdcSchema: SfdcSchema,
    selection: FieldNode,
): SOQLSelect | undefined {
    const fieldName = selection.name.value;

    // Ignore meta fields.
    if (fieldName.startsWith('__')) {
        return;
    }

    const fieldType = objectType.getFields()[fieldName];

    const entityField = entity.fields.find((entity) => entity.name === fieldName);
    const entityRelationship = entity.childRelationships.find(
        (relation) => relation.name === fieldName,
    );

    if (entityField) {
        if (isScalarField(entityField)) {
            return {
                type: SOQLFieldType.FIELD,
                name: entityField.name,
            };
        } else if (isReferenceField(entityField) && selection.selectionSet) {
            const referenceEntity = entityField.referencedEntity!;
            const referenceObjectType = assertObjectType(fieldType.type);

            const selects = resolveSelection(
                info,
                referenceEntity,
                referenceObjectType,
                sfdcSchema,
                selection.selectionSet,
            );

            return {
                type: SOQLFieldType.REFERENCE,
                name: entityField.relationshipName,
                selects,
            };
        } else if (isPolymorphicReference(entityField) && selection.selectionSet) {
            // TODO: Handle polymorphic relationships.
        }
    } else if (entityRelationship) {
        const relationshipEntity = entityRelationship.entity!;
        const relationshipType = assertObjectType(fieldType.type);

        const selects = resolveSelection(
            info,
            relationshipEntity,
            relationshipType,
            sfdcSchema,
            selection.selectionSet!,
        );

        const queryArgs = resolveQueryManyArgs(info, entity, fieldType, selection);

        return {
            type: SOQLFieldType.SUB_QUERY,
            table: entityRelationship.name,
            selects,
            ...queryArgs,
        };
    } else {
        assert.fail(`Can't find field or relationship named "${fieldName}" on "${entity.name}"`);
    }
}

function resolveInlineFragmentSelection(
    info: GraphQLResolveInfo,
    entity: Entity,
    objectType: GraphQLObjectType<any, any>,
    sfdcSchema: SfdcSchema,
    selection: InlineFragmentNode,
): SOQLSelect[] {
    let fragmentEntity = entity;
    let fragmentObjectType = objectType;

    if (selection.typeCondition) {
        const entityName = selection.typeCondition.name.value;

        fragmentEntity = sfdcSchema.entities[entityName];
        fragmentObjectType = assertObjectType(info.schema.getType(entityName));
    }

    return resolveSelection(
        info,
        fragmentEntity,
        fragmentObjectType,
        sfdcSchema,
        selection.selectionSet,
    );
}

function resolveFragmentSelection(
    info: GraphQLResolveInfo,
    sfdcSchema: SfdcSchema,
    selection: FragmentSpreadNode,
): SOQLSelect[] {
    const fragmentName = selection.name.value;
    const fragment = info.fragments[fragmentName];

    const entityName = fragment.typeCondition.name.value;

    const fragmentEntity = sfdcSchema.entities[entityName];
    const fragmentObjectType = assertObjectType(info.schema.getType(entityName));

    return resolveSelection(
        info,
        fragmentEntity,
        fragmentObjectType,
        sfdcSchema,
        fragment.selectionSet,
    );
}
