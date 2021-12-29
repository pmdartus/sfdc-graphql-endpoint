import { DescribeSObjectResult, SObjectField, SObjectFieldType } from './sfdc/types/describe-sobject';

export interface Entity {
    sfdcName: string;
    gqlName: string;
    fields: Field[];
    config: EntityConfig;
}

interface EntityConfig {
    createable: boolean;
    updateable: boolean;
    deletable: boolean;
    queryable: boolean;
}

interface BaseField<T extends SObjectFieldType> {
    type: T;
    sfdcName: string;
    gqlName: string;
    config: FieldConfig;
}

interface FieldConfig {
    nillable: boolean;
    createable: boolean;
    updatable: boolean;
    filterable: boolean;
    groupable: boolean;
    sortable: boolean;
    updateable: boolean;
    aggregatable: boolean;
}

interface ReferenceField extends BaseField<'reference'> {
    referenceTo: string[];
}
interface PickList extends BaseField<'picklist'> {
    values: string[];
}
interface MultiPickList extends BaseField<'multipicklist'> {
    values: string[];
}
interface Combobox extends BaseField<'combobox'> {
    values: string[];
}

export type Field =
    | BaseField<'string'>
    | BaseField<'boolean'>
    | BaseField<'int'>
    | BaseField<'double'>
    | BaseField<'date'>
    | BaseField<'datetime'>
    | BaseField<'base64'>
    | BaseField<'id'>
    | BaseField<'currency'>
    | BaseField<'textarea'>
    | BaseField<'percent'>
    | BaseField<'phone'>
    | BaseField<'url'>
    | BaseField<'email'>
    | BaseField<'anyType'>
    // | BaseField<'address'>     TODO: Check implication of compound field
    // | BaseField<'location'>    TODO: Check implication of compound field
    | ReferenceField
    | PickList
    | MultiPickList
    | Combobox;

function gqlFieldName(sObjectField: SObjectField): string {
    let name = sObjectField.name[0].toLowerCase() + sObjectField.name.slice(1);

    if (sObjectField.type === 'reference' && name.endsWith('Id')) {
        name = name.slice(0, -2);
    }

    return name;
}

function createField(sObjectField: SObjectField): Field | undefined {
    const { name, type } = sObjectField;

    const baseField = {
        sfdcName: name,
        gqlName: gqlFieldName(sObjectField),
        config: {
            nillable: sObjectField.nillable,
            createable: sObjectField.createable,
            updatable: sObjectField.updateable,
            filterable: sObjectField.filterable,
            groupable: sObjectField.groupable,
            sortable: sObjectField.sortable,
            updateable: sObjectField.updateable,
            aggregatable: sObjectField.aggregatable,
        },
    };

    switch (type) {
        case 'string':
        case 'boolean':
        case 'int':
        case 'double':
        case 'date':
        case 'datetime':
        case 'base64':
        case 'id':
        case 'currency':
        case 'textarea':
        case 'percent':
        case 'phone':
        case 'url':
        case 'email':
        case 'anyType':
            return {
                type,
                ...baseField,
            };

        case 'reference':
            return {
                type,
                referenceTo: sObjectField.referenceTo,
                ...baseField,
            };

        case 'combobox':
        case 'picklist':
        case 'multipicklist':
            return {
                type,
                values: sObjectField.picklistValues.map((entry) => entry.value),
                ...baseField,
            };
    }
}

export function createEntity(sObject: DescribeSObjectResult): Entity {
    const { name } = sObject;
    const fields = sObject.fields
        .map((field) => createField(field))
        .filter((f: Field | undefined): f is Field => f !== undefined);

    return {
        sfdcName: name,
        gqlName: name,
        fields,
        config: {
            createable: sObject.createable,
            updateable: sObject.updateable,
            deletable: sObject.deletable,
            queryable: sObject.queryable,
        },
    };
}
