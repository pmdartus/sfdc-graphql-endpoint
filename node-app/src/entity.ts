import { camelCase } from './utils/string.js';

import {
    DescribeSObjectResult,
    SObjectChildRelationship,
    SObjectField,
    SObjectFieldType,
} from './sfdc/types/describe-sobject.js';

export interface Entity {
    sfdcName: string;
    gqlName: string;
    config: EntityConfig;
    fields: Field[];
    childRelationships: ChildRelationship[];
}

export interface ChildRelationship {
    sfdcName: string;
    gqlName: string;
    entity: string;
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
    updateable: boolean;
    filterable: boolean;
    groupable: boolean;
    sortable: boolean;
    aggregatable: boolean;
}

export type ScalarField =
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
    | BaseField<'address'>
    | BaseField<'location'>
    | BaseField<'picklist'>
    | BaseField<'multipicklist'>
    | BaseField<'combobox'>;

export interface ReferenceField extends BaseField<'reference'> {
    sfdcRelationshipName: string;
    referenceTo: string[];
}

export type Field = ReferenceField | ScalarField;

function createField(sObjectField: SObjectField): Field | undefined {
    const {
        name: sfdcName,
        type,
        nillable,
        createable,
        updateable,
        filterable,
        groupable,
        sortable,
        aggregatable,
    } = sObjectField;

    const config = {
        nillable,
        createable,
        updateable,
        filterable,
        groupable,
        sortable,
        aggregatable,
    };

    if (type === 'reference') {
        if (sObjectField.relationshipName === null) {
            return;
        }

        return {
            type,
            sfdcName,
            gqlName: camelCase(sObjectField.relationshipName),
            referenceTo: sObjectField.referenceTo,
            sfdcRelationshipName: sObjectField.relationshipName,
            config,
        };
    } else {
        return {
            type,
            sfdcName,
            gqlName: camelCase(sObjectField.name),
            config,
        };
    }
}

function createChildRelationShip(
    relationship: SObjectChildRelationship,
): ChildRelationship | undefined {
    if (relationship.relationshipName === null) {
        return;
    }

    return {
        sfdcName: relationship.relationshipName,
        gqlName: camelCase(relationship.relationshipName),
        entity: relationship.childSObject,
    };
}

export function createEntity(sObject: DescribeSObjectResult): Entity {
    const { name, createable, updateable, deletable, queryable } = sObject;

    const fields: Field[] = [];
    const childRelationships: ChildRelationship[] = [];

    for (const sObjectField of sObject.fields) {
        const field = createField(sObjectField);
        if (field) {
            fields.push(field);
        }
    }
    for (const sObjectRelationShip of sObject.childRelationships) {
        const relationship = createChildRelationShip(sObjectRelationShip);
        if (relationship) {
            childRelationships.push(relationship);
        }
    }

    return {
        sfdcName: name,
        gqlName: name,
        config: {
            createable,
            updateable,
            deletable,
            queryable,
        },
        fields,
        childRelationships,
    };
}

export function assertScalarField(field: Field): asserts field is ScalarField {
    if (field.type === 'reference') {
        throw new Error(`Expected a scalar field but received a ${field.type}.`);
    }
}

export function assertReferenceField(field: Field): asserts field is ReferenceField {
    if (field.type !== 'reference') {
        throw new Error(`Expected a reference field but received a ${field.type}.`);
    }
}