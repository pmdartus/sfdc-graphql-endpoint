import {
    GraphQLOutputType,
    GraphQLResolveInfo,
    isObjectType,
    Kind,
    SelectionNode,
    assertObjectType,
    GraphQLObjectType,
    getNamedType,
} from 'graphql';
import { ReferenceField } from './entity';
import { SOQLRecord, SOQLResult } from './sfdc/types/soql';

interface SoqlQueryMapping {
    selects: SoqlSelect[];
    from: string;
    limit?: number;
    offset?: number;
}

type SoqlSelect = SoqlFieldSelect | SoqlLookupSelect;

interface SoqlFieldSelect {
    type: 'field';
    sfdcName: string;
    gqlName: string;
}

interface SoqlLookupSelect {
    type: 'lookup';
    sfdcName: string;
    gqlName: string;
    selects: SoqlSelect[];
}

export function resolveInfoToSoqlQuery(
    info: GraphQLResolveInfo,
    returnType: GraphQLOutputType,
    config?: {
        limit?: number;
        offset?: number;
    },
): SoqlQueryMapping {
    if (!isObjectType(returnType)) {
        throw new Error(`Unexpected return type ${returnType.toString()}`);
    }

    const { fieldNodes } = info;
    const { selectionSet } = fieldNodes[0];

    const tableName = returnType.extensions.sfdc!.sfdcName;
    const select: SoqlSelect[] = [];

    for (const selection of selectionSet!.selections) {
        const soqlSelect = resolveSelection(info, returnType, selection);
        if (soqlSelect) {
            select.push(...soqlSelect);
        }
    }

    return {
        from: tableName,
        selects: select,
        limit: config?.limit,
        offset: config?.offset,
    };
}

function resolveSelection(
    info: GraphQLResolveInfo,
    type: GraphQLObjectType,
    selection: SelectionNode,
): SoqlSelect[] {
    const { schema, fragments } = info;
    const res: SoqlSelect[] = [];

    switch (selection.kind) {
        case Kind.FIELD: {
            // Ignore meta fields.
            if (selection.name.value.startsWith('__')) {
                break;
            }

            const field = type.getFields()[selection.name.value];
            const sfdc = field.extensions.sfdc!;

            if (!selection.selectionSet) {
                res.push({
                    type: 'field',
                    sfdcName: sfdc.sfdcName,
                    gqlName: sfdc.gqlName,
                });
            } else {
                const objectType = getNamedType(field.type) as GraphQLObjectType;
                const select: SoqlSelect[] = [];

                for (const childSelection of selection.selectionSet.selections) {
                    const res = resolveSelection(info, objectType, childSelection);
                    select.push(...res);
                }

                res.push({
                    type: 'lookup',
                    sfdcName: (sfdc as ReferenceField).sfdcRelationshipName,
                    gqlName: sfdc.gqlName,
                    selects: select,
                });
            }
            break;
        }

        case Kind.INLINE_FRAGMENT: {
            if (selection.typeCondition) {
                const fragmentType = schema.getType(selection.typeCondition.name.value);
                type = assertObjectType(fragmentType);
            }

            for (const fragSelection of selection.selectionSet.selections) {
                const soqlSelect = resolveSelection(info, type, fragSelection);
                if (soqlSelect) {
                    res.push(...soqlSelect);
                }
            }
            break;
        }

        case Kind.FRAGMENT_SPREAD: {
            const fragment = fragments[selection.name.value];
            const type = schema.getType(fragment.typeCondition.name.value) as GraphQLObjectType;

            for (const fragSelection of fragment.selectionSet.selections) {
                const soqlSelect = resolveSelection(info, type, fragSelection);
                if (soqlSelect) {
                    res.push(...soqlSelect);
                }
            }
            break;
        }
    }

    return res;
}

function selectFieldsToString(selects: SoqlSelect[], prefix = ''): string[] {
    return selects.flatMap((select) => {
        if (select.type === 'field') {
            return prefix + select.sfdcName;
        } else {
            return selectFieldsToString(select.selects, `${select.sfdcName}.`);
        }
    });
}

export function soqlQueryMappingToString(queryMapping: SoqlQueryMapping): string {
    let query = `SELECT ${selectFieldsToString(queryMapping.selects).join(', ')}`;
    query += ` FROM ${queryMapping.from}`;

    if (queryMapping.limit) {
        query += ` LIMIT ${queryMapping.limit}`;
    }
    if (queryMapping.offset) {
        query += ` OFFSET ${queryMapping.offset}`;
    }

    return query;
}

function extractResultFromSelect(selects: SoqlSelect[], record: SOQLRecord): any {
    return Object.fromEntries(selects.map(select => {
        const name = select.gqlName;

        let value;
        if (select.type === 'field') {
            value = record[select.sfdcName];
        } else {
            value = extractResultFromSelect(select.selects, record[select.sfdcName] as SOQLRecord);
        }

        return [name, value];
    }))
}

export function soqlResultToGraphQLOutput(queryMapping: SoqlQueryMapping, result: SOQLResult): any {
    return result.records.map(record => extractResultFromSelect(queryMapping.selects, record))
}