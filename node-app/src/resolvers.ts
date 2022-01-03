import {
    GraphQLResolveInfo,
    Kind,
    GraphQLObjectType,
    GraphQLFieldResolver,
    SelectionSetNode,
    ArgumentNode,
    IntValueNode,
    ObjectValueNode,
    FieldNode,
    GraphQLSchema,
    isObjectType,
    ValueNode,
} from 'graphql';

import { GraphQLSortOrderValue } from './graphql.js';
import { Entity, isPolymorphicReference, isReferenceField, isScalarField } from './entity.js';

import { Api } from './sfdc/api.js';
import { Connection } from './sfdc/connection.js';
import {
    queryToString,
    SOQLComparisonOperator,
    SOQLConditionExpr,
    SOQLConditionExprType,
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

            const selects = resolveSelection(info, entity, info.fieldNodes[0].selectionSet!);

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

            const selects = resolveSelection(info, entity, info.fieldNodes[0].selectionSet!);

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
                res.limit = resolveValueIntNode(info, arg.value);
                break;
            }

            case 'offset': {
                res.offset = resolveValueIntNode(info, arg.value);
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
    console.log(conditionExprValue.fields, info.variableValues);
    return undefined as any;

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
    const { schema } = info;

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
            if (isReferenceField(entityField)) {
                const referencedEntity = getEntityByName(schema, entityField.sfdcReferencedEntityName)!;
                return resolveOrderBy(info, referencedEntity, orderByField.value).map(item => {
                    return {
                        ...item,
                        field: `${entityField.sfdcRelationshipName}.${item.field}`
                    }
                });
            } else {
                // TODO: Handle polymorphic relationships.
                return [];
            }
        } else {
            throw new Error('Unexpected field value kind');
        }
    });
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

                const field = entity.fields.find(
                    (entity) => entity.gqlName === selection.name.value,
                );
                if (!field) {
                    console.log(entity);
                    throw new Error(`Unkown field ${selection.name.value} on ${entity.gqlName}`);
                }

                if (isScalarField(field)) {
                    soqlSelects.push({
                        type: SoqlFieldType.FIELD,
                        name: field.sfdcName,
                    });
                } else if (isReferenceField(field) && selection.selectionSet) {
                    const referenceEntity = getEntityByName(schema, field.sfdcReferencedEntityName)!;

                    soqlSelects.push({
                        type: SoqlFieldType.REFERENCE,
                        name: field.sfdcRelationshipName,
                        selects: resolveSelection(info, referenceEntity, selection.selectionSet),
                    });
                } else if (isPolymorphicReference(field) && selection.selectionSet) {
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
function getEntityByName(schema: GraphQLSchema, sfdcName: string): Entity | undefined {
    return Object.values(schema.getTypeMap()).find(
        (type): type is GraphQLObjectType =>
            isObjectType(type) && type.extensions.sfdc?.sfdcName === sfdcName,
    )?.extensions.sfdc;
}

function resolveValueIntNode(info: GraphQLResolveInfo, value: ValueNode): number {
    if (value.kind === Kind.VARIABLE) {
        return info.variableValues[value.name.value] as number;
    } else if (value.kind === Kind.INT) {
        return parseInt(value.value);
    } else {
        throw new Error(`Expected int value but received ${value}`);
    }
}