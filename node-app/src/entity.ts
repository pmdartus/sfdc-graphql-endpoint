import { DescribeSObjectResult, SObjectField, SObjectFieldType } from './sfdc/types/describe-sobject';

export interface Entity {
    sfdcName: string;
    gqlName: string;
    fields: Field[];
    config: EntityConfig;
}

export interface EntityConfig {
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

export interface FieldConfig {
    nillable: boolean;
    createable: boolean;
    updatable: boolean;
    filterable: boolean;
    groupable: boolean;
    sortable: boolean;
    updateable: boolean;
    aggregatable: boolean;
}

export interface ReferenceField extends BaseField<'reference'> {
    sfdcRelationshipName: string;
    referenceTo: string[];
}
export interface PickList extends BaseField<'picklist'> {
    values: string[];
}
export interface MultiPickList extends BaseField<'multipicklist'> {
    values: string[];
}
export interface Combobox extends BaseField<'combobox'> {
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
    const name = sObjectField.relationshipName ?? sObjectField.name;
    return name[0].toLowerCase() + name.slice(1);
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
                ...baseField,
                type,
            };

        case 'reference':
            return {
                ...baseField,
                type,
                referenceTo: sObjectField.referenceTo,
                sfdcRelationshipName: sObjectField.relationshipName!,
            };

        case 'combobox':
        case 'picklist':
        case 'multipicklist':
            return {
                ...baseField,
                type,
                values: sObjectField.picklistValues.map((entry) => entry.value),
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
