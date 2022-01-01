import {
    assertObjectType,
    GraphQLResolveInfo,
    Kind,
    SelectionNode,
    GraphQLObjectType,
    getNamedType,
    GraphQLFieldResolver,
    SelectionSetNode,
    ArgumentNode,
    IntValueNode,
    ObjectValueNode,
    GraphQLSchema,
} from 'graphql';

import { assertReferenceField, Entity, ReferenceField } from './entity';
import { GraphQLSortOrderValue } from './graphql';

import { Api } from './sfdc/api';
import { Connection } from './sfdc/connection';
import {
    queryToString,
    SOQLComparisonOperator,
    SOQLConditionExpr,
    SOQLConditionExprType,
    SOQLLogicalOperator,
    SOQLOrderByItem,
    SOQLQuery,
    SOQLSelect,
    SOQLSortingOrder,
} from './sfdc/soql.js';

import { Logger } from './utils/logger';

export interface ResolverContext {
    connection: Connection;
    api: Api;
    logger?: Logger;
}

type SOQLQueryOptionals = Pick<SOQLQuery, 'where' | 'orderBy' | 'limit' | 'offset'>;

const GRAPHQL_SORTING_ORDER_SOQL_MAPPING: { [name in GraphQLSortOrderValue]: SOQLSortingOrder } = {
    ASC: SOQLSortingOrder.ASC,
    DESC: SOQLSortingOrder.DESC,
    ASC_NULLS_FIRST: SOQLSortingOrder.ASC_NULLS_FIRST,
    ASC_NULLS_LAST: SOQLSortingOrder.ASC_NULLS_LAST,
    DESC_NULLS_FIRST: SOQLSortingOrder.DESC_NULLS_FIRST,
    DESC_NULLS_LAST: SOQLSortingOrder.DESC_NULLS_LAST,
};

export const soqlResolvers = {
    query(entity: Entity): GraphQLFieldResolver<unknown, ResolverContext> {
        return async (_, args, context, info) => {
            const { api, logger } = context;

            const selects = resolveSelection(
                info,
                info.returnType as GraphQLObjectType,
                info.fieldNodes[0].selectionSet!,
            );

            const queryString = queryToString({
                selects,
                table: entity.sfdcName,
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

            const selects = resolveSelection(
                info,
                info.returnType as GraphQLObjectType,
                info.fieldNodes[0].selectionSet!,
            );

            const soqlConfig = resolveQueryManyArgs(info, entity, info.fieldNodes[0].arguments);

            const query = queryToString({
                selects,
                table: entity.sfdcName,
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
    args?: Readonly<ArgumentNode[]>,
): SOQLQueryOptionals {
    const res: SOQLQueryOptionals = {};

    if (!args) {
        return res;
    }

    for (const arg of args) {
        switch (arg.name.value) {
            case 'limit': {
                const intValue = arg.value as IntValueNode;
                res.limit = parseInt(intValue.value);
                break;
            }

            case 'offset': {
                const intValue = arg.value as IntValueNode;
                res.offset = parseInt(intValue.value);
                break;
            }

            case 'where': {
                const objectValue = arg.value as ObjectValueNode;
                res.where = resolveConditionExpr(info, entity, objectValue);
                break;
            }

            case 'order_by': {
                const objectValue = arg.value as ObjectValueNode;
                res.orderBy = resolveOrderBy(info, entity, objectValue);
                break;
            }

            default:
                throw new Error(`Unknown argument name ${arg.name.value}`);
        }
    }

    return res;
}

function resolveConditionExpr(
    info: GraphQLResolveInfo,
    entity: Entity,
    conditionExprValue: ObjectValueNode,
): SOQLConditionExpr {
    throw new Error('TODO');

    // const isConditional = conditionExprValue.fields.some(
    //     (field) => field.name.value === '_and' || field.name.value === '_or',
    // );

    // if (isConditional) {
    //     if (conditionExprValue.fields.length > 1) {
    //         // TODO: Improve error message. A conditional expression can't be associated with column
    //         // expressions.
    //         throw new Error('Unexpected conditional value');
    //     }

    //     const operator =
    //         conditionExprValue.fields[0].name.value === '_and'
    //             ? SOQLLogicalOperator.AND
    //             : SOQLLogicalOperator.OR;

    //     return {
    //         type: SOQLConditionExprType.LOGICAL_EXPR,
    //         operator: operator,
    //         left,
    //         right,
    //     };
    // } else {
    // }
}

function resolveOrderBy(
    info: GraphQLResolveInfo,
    entity: Entity,
    orderByValue: ObjectValueNode,
): SOQLOrderByItem[] {
    return orderByValue.fields.flatMap((orderByField) => {
        const entityField = entity.fields.find(
            (field) => field.gqlName === orderByField.name.value,
        );
        if (!entityField) {
            throw new Error(`Can't find field ${orderByField.name.value} on ${entity.gqlName}`);
        }

        if (orderByField.value.kind === Kind.ENUM) {
            return {
                field: entityField.sfdcName,
                order: GRAPHQL_SORTING_ORDER_SOQL_MAPPING[
                    orderByField.value.value as GraphQLSortOrderValue
                ],
            };
        } else if (orderByField.value.kind === Kind.OBJECT) {
            // TODO
            return [];

            // assertReferenceField(entityField);

            // return resolveOrderBy(info, entity, orderByField.value).map(item => {
            //     return {
            //         ...item,
            //         field: `${entityField.sfdcName}.${item.field}`
            //     }
            // });
        } else {
            throw new Error('Unexpected field value kind');
        }
    });
}

function resolveSelection(
    info: GraphQLResolveInfo,
    type: GraphQLObjectType,
    selection: SelectionSetNode,
): SOQLSelect[] {
    const { schema, fragments } = info;
    const res: SOQLSelect[] = [];

    // switch (selection.kind) {
    //     case Kind.FIELD: {
    //         // Ignore meta fields.
    //         if (selection.name.value.startsWith('__')) {
    //             break;
    //         }

    //         const field = type.getFields()[selection.name.value];
    //         const sfdc = field.extensions.sfdc!;

    //         if (!selection.selectionSet) {
    //             res.push({
    //                 type: 'field',
    //                 name: sfdc.sfdcName,
    //             });
    //         } else {
    //             const objectType = getNamedType(field.type) as GraphQLObjectType;
    //             const select: SoqlSelect[] = [];

    //             for (const childSelection of selection.selectionSet.selections) {
    //                 const res = resolveSelection(info, objectType, childSelection);
    //                 select.push(...res);
    //             }

    //             res.push({
    //                 type: 'reference',
    //                 name: (sfdc as ReferenceField).sfdcRelationshipName,
    //                 selects: select,
    //             });
    //         }
    //         break;
    //     }

    //     case Kind.INLINE_FRAGMENT: {
    //         if (selection.typeCondition) {
    //             const fragmentType = schema.getType(selection.typeCondition.name.value);
    //             type = assertObjectType(fragmentType);
    //         }

    //         for (const fragSelection of selection.selectionSet.selections) {
    //             const soqlSelect = resolveSelection(info, type, fragSelection);
    //             if (soqlSelect) {
    //                 res.push(...soqlSelect);
    //             }
    //         }
    //         break;
    //     }

    //     case Kind.FRAGMENT_SPREAD: {
    //         const fragment = fragments[selection.name.value];
    //         const type = schema.getType(fragment.typeCondition.name.value) as GraphQLObjectType;

    //         for (const fragSelection of fragment.selectionSet.selections) {
    //             const soqlSelect = resolveSelection(info, type, fragSelection);
    //             if (soqlSelect) {
    //                 res.push(...soqlSelect);
    //             }
    //         }
    //         break;
    //     }
    // }

    return res;
}
