export interface SOQLQuery {
    selects: SOQLSelect[];
    table: string;
    where?: SOQLConditionExpr;
    orderBy?: SOQLOrderByItem[];
    limit?: number;
    offset?: number;
}

export type SOQLSelect = SOQLFieldSelect | SOQLReferenceSelect;

export const enum SoqlFieldType {
    FIELD,
    REFERENCE,
}

export interface SOQLFieldSelect {
    type: SoqlFieldType.FIELD;
    name: string;
}

export interface SOQLReferenceSelect {
    type: SoqlFieldType.REFERENCE;
    name: string;
    selects: SOQLSelect[];
}

export type SOQLConditionExpr = SOQLFieldExpr | SOQLLogicalExpr;

export const enum SOQLConditionExprType {
    FIELD_EXPR,
    LOGICAL_EXPR,
}

export const enum SOQLComparisonOperator {
    EQ,
    NEQ,
    LT,
    LTE,
    GT,
    GTE,
    LIKE,
    IN,
    NIN,
    INCLUDES,
    EXCLUDES,
}

export const enum SOQLLogicalOperator {
    AND,
    OR,
}

export interface SOQLFieldExpr {
    type: SOQLConditionExprType.FIELD_EXPR;
    field: string;
    operator: SOQLComparisonOperator;
    value: unknown;
}

export interface SOQLLogicalExpr {
    type: SOQLConditionExprType.LOGICAL_EXPR;
    left: SOQLConditionExpr;
    operator: SOQLLogicalOperator;
    right: SOQLConditionExpr;
}

export const enum SOQLSortingOrder {
    ASC,
    DESC,
    ASC_NULLS_FIRST,
    ASC_NULLS_LAST,
    DESC_NULLS_FIRST,
    DESC_NULLS_LAST,
}

export interface SOQLOrderByItem {
    field: string;
    order: SOQLSortingOrder;
}

export function queryToString(query: SOQLQuery): string {
    let res = `SELECT ${selectsToString(query.selects).join(', ')}`;
    res += ` FROM ${query.table}`;

    if (query.where) {
        res += ` WHERE ${conditionExprToString(query.where)}`;
    }

    if (query.orderBy) {
        const items = query.orderBy.map(orderByItemToString);
        res += ` ORDER BY ${items.join(', ')}`;
    }

    if (query.limit) {
        res += ` LIMIT ${query.limit}`;
    }

    if (query.offset) {
        res += ` OFFSET ${query.offset}`;
    }

    return res;
}

function selectsToString(selects: SOQLSelect[], prefix = ''): string[] {
    return selects.flatMap((select) => {
        if (select.type === SoqlFieldType.FIELD) {
            return prefix + select.name;
        } else {
            return selectsToString(select.selects, `${select.name}.`);
        }
    });
}

function conditionExprToString(
    expr: SOQLConditionExpr,
    options: { wrapParentheses?: boolean } = {},
): string {
    if (expr.type === SOQLConditionExprType.FIELD_EXPR) {
        let op;
        switch (expr.operator) {
            case SOQLComparisonOperator.EQ:
                op = '=';
                break;
            case SOQLComparisonOperator.NEQ:
                op = '!=';
                break;
            case SOQLComparisonOperator.LT:
                op = '<';
                break;
            case SOQLComparisonOperator.LTE:
                op = '<=';
                break;
            case SOQLComparisonOperator.GT:
                op = '>';
                break;
            case SOQLComparisonOperator.GTE:
                op = '>=';
                break;
            case SOQLComparisonOperator.LIKE:
                op = 'LIKE';
                break;
            case SOQLComparisonOperator.IN:
                op = 'IN';
                break;
            case SOQLComparisonOperator.NIN:
                op = 'NOT IN';
                break;
            case SOQLComparisonOperator.INCLUDES:
                op = 'INCLUDES';
                break;
            case SOQLComparisonOperator.EXCLUDES:
                op = 'EXCLUDES';
                break;
        }

        return `${expr.field} ${op} ${serializeValue(expr.value)}`;
    } else {
        let op;

        switch (expr.operator) {
            case SOQLLogicalOperator.AND:
                op = 'AND';
                break;
            case SOQLLogicalOperator.OR:
                op = 'OR';
                break;
        }

        const left = conditionExprToString(expr.left, { wrapParentheses: true });
        const right = conditionExprToString(expr.right, { wrapParentheses: true });

        let res = `${left} ${op} ${right}`;
        if (options.wrapParentheses) {
            res = `(${res})`;
        }

        return res;
    }
}

function orderByItemToString(item: SOQLOrderByItem): string {
    let ordering;
    switch (item.order) {
        case SOQLSortingOrder.ASC:
            ordering = 'ASC';
            break;

        case SOQLSortingOrder.DESC:
            ordering = 'DESC';
            break;

        case SOQLSortingOrder.ASC_NULLS_FIRST:
            ordering = 'ASC NULLS FIRST';
            break;

        case SOQLSortingOrder.ASC_NULLS_LAST:
            ordering = 'ASC NULLS LAST';
            break;

        case SOQLSortingOrder.DESC_NULLS_FIRST:
            ordering = 'DESC NULLS FIRST';
            break;

        case SOQLSortingOrder.DESC_NULLS_LAST:
            ordering = 'DESC NULLS LAST';
            break;
    }

    return `${item.field} ${ordering}`;
}

function serializeValue(value: unknown): string {
    if (typeof value === 'boolean') {
        return value ? 'TRUE' : 'FALSE';
    } else if (typeof value === 'number') {
        return String(value);
    } else if (typeof value === 'string') {
        return `'${value}'`;
    } else if (Array.isArray(value)) {
        return `(${value.map((val) => serializeValue(val)).join(', ')})`;
    }

    return String(value);
}
