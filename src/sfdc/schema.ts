import {
    DescribeSObjectResult,
    SObjectChildRelationship,
    SObjectField,
    SObjectFieldType,
} from './types/describe-sobject.js';

export interface SfdcSchema {
    entities: { [name: string]: Entity };
}

export interface Entity {
    name: string;
    config: EntityConfig;
    fields: Field[];
    childRelationships: ChildRelationship[];
}

export interface ChildRelationship {
    name: string;
    field: string;
    entity: Entity | undefined;
}

export interface EntityConfig {
    createable: boolean;
    updateable: boolean;
    deletable: boolean;
    queryable: boolean;
}

interface BaseField<T extends FieldType> {
    type: T;
    name: string;
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

export const enum FieldType {
    STRING = 'String',
    ENCRYPTED_STRING = 'EncryptedString',
    BOOLEAN = 'Boolean',
    INT = 'Int',
    FLOAT = 'Float',
    DATE = 'Date',
    DATETIME = 'DateTime',
    TIME = 'Time',
    BASE64 = 'Base64',
    ID = 'Id',
    CURRENCY = 'Currency',
    TEXTAREA = 'TextArea',
    PERCENT = 'Percent',
    PHONE = 'Phone',
    URL = 'URL',
    EMAIL = 'Email',
    ANY_TYPE = ' AnyType',
    ADDRESS = 'Address',
    LOCATION = 'Location',
    PICKLIST = 'Picklist',
    MULTI_PICKLIST = 'MultiPicklist',
    COMBOBOX = 'ComboBox',
    REFERENCE = 'Reference',
    POLYMORPHIC_REFERENCE = 'PolymorphicReference',
}

export type ScalarField =
    | BaseField<FieldType.STRING>
    | BaseField<FieldType.ENCRYPTED_STRING>
    | BaseField<FieldType.BOOLEAN>
    | BaseField<FieldType.INT>
    | BaseField<FieldType.FLOAT>
    | BaseField<FieldType.DATE>
    | BaseField<FieldType.DATETIME>
    | BaseField<FieldType.TIME>
    | BaseField<FieldType.BASE64>
    | BaseField<FieldType.ID>
    | BaseField<FieldType.CURRENCY>
    | BaseField<FieldType.TEXTAREA>
    | BaseField<FieldType.PERCENT>
    | BaseField<FieldType.PHONE>
    | BaseField<FieldType.URL>
    | BaseField<FieldType.EMAIL>
    | BaseField<FieldType.ANY_TYPE>
    | BaseField<FieldType.EMAIL>
    | BaseField<FieldType.ADDRESS>
    | BaseField<FieldType.LOCATION>
    | BaseField<FieldType.PICKLIST>
    | BaseField<FieldType.MULTI_PICKLIST>
    | BaseField<FieldType.COMBOBOX>;

type EntityReference = Entity | undefined;

export interface ReferenceField extends BaseField<FieldType.REFERENCE> {
    relationshipName: string;
    referencedEntity: EntityReference;
}

export interface PolymorphicReferenceField extends BaseField<FieldType.POLYMORPHIC_REFERENCE> {
    relationshipName: string;
    referencedEntities: EntityReference[];
}

export type Field = ScalarField | ReferenceField | PolymorphicReferenceField;

const SOBJECT_FIELD_SCALAR_TYPE_MAPPING: {
    [type in Exclude<SObjectFieldType, 'reference'>]: ScalarField['type'];
} = {
    string: FieldType.STRING,
    encryptedstring: FieldType.ENCRYPTED_STRING,
    boolean: FieldType.BOOLEAN,
    int: FieldType.INT,
    double: FieldType.FLOAT,
    date: FieldType.DATE,
    datetime: FieldType.DATETIME,
    time: FieldType.TIME,
    base64: FieldType.BASE64,
    id: FieldType.ID,
    currency: FieldType.CURRENCY,
    textarea: FieldType.TEXTAREA,
    percent: FieldType.PERCENT,
    phone: FieldType.PHONE,
    url: FieldType.URL,
    email: FieldType.EMAIL,
    combobox: FieldType.COMBOBOX,
    picklist: FieldType.PICKLIST,
    multipicklist: FieldType.MULTI_PICKLIST,
    anyType: FieldType.ANY_TYPE,
    address: FieldType.ADDRESS,
    location: FieldType.LOCATION,
};

export function createSfdcSchema(config: { sObjects: DescribeSObjectResult[] }): SfdcSchema {
    const schema: SfdcSchema = { entities: {} };

    for (const sObject of config.sObjects) {
        const entity = createEntity(schema, sObject);
        schema.entities[entity.name] = entity;
    }

    return schema;
}

function createEntity(schema: SfdcSchema, sObject: DescribeSObjectResult): Entity {
    const { name, createable, updateable, deletable, queryable } = sObject;

    const fields = sObject.fields
        .map((field) => createField(schema, field))
        .filter((field): field is Field => field !== undefined);

    const childRelationships = sObject.childRelationships
        .map((relationship) => createChildRelationShip(schema, relationship))
        .filter((rel): rel is ChildRelationship => rel !== undefined);

    return {
        name,
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

function createField(schema: SfdcSchema, sObjectField: SObjectField): Field | undefined {
    const {
        name,
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
        // Ignores the reference field when it doesn't have a relationship name. This shouldn't be
        // possible per the documentation, however it is the case for "DelegatedApproverId" field
        // the standard "Account" object.
        if (!sObjectField.relationshipName) {
            return;
        }

        const baseReferenceField = {
            name,
            relationshipName: sObjectField.relationshipName,
            config,
        };

        if (sObjectField.polymorphicForeignKey) {
            return {
                type: FieldType.POLYMORPHIC_REFERENCE,
                ...baseReferenceField,
                get referencedEntities() {
                    return sObjectField.referenceTo.map(entityName => schema.entities[entityName])
                },
            };
        } else {
            return {
                type: FieldType.REFERENCE,
                ...baseReferenceField,
                get referencedEntity() {
                    return schema.entities[sObjectField.referenceTo[0]]
                },
            };
        }
    } else {
        // TODO: What should be done with compound fields? Compound fields contains duplicate
        // information, that will be present in other fields.
        // For example:
        //  - name -> first name + last name
        //  - address -> address city + address street + ...
        return {
            type: SOBJECT_FIELD_SCALAR_TYPE_MAPPING[type],
            name,
            config,
        };
    }
}

function createChildRelationShip(
    schema: SfdcSchema,
    relationship: SObjectChildRelationship,
): ChildRelationship | undefined {
    const { relationshipName, field, childSObject, } = relationship;

    if (relationshipName === null) {
        return;
    }

    return {
        name: relationshipName,
        field,
        get entity() {
            return schema.entities[childSObject];
        }
    };
}

export function isScalarField(field: Field): field is ScalarField {
    return field.type !== FieldType.REFERENCE && field.type !== FieldType.POLYMORPHIC_REFERENCE;
}

export function assertScalarField(field: Field): asserts field is ScalarField {
    if (!isScalarField(field)) {
        throw new Error(`Expected a scalar field but received a ${field.type}.`);
    }
}

export function isReferenceField(field: Field): field is ReferenceField {
    return field.type === FieldType.REFERENCE;
}

export function assertReferenceField(field: Field): asserts field is ReferenceField {
    if (!isReferenceField(field)) {
        throw new Error(`Expected a reference field but received a ${field.type}.`);
    }
}

export function isPolymorphicReference(field: Field): field is PolymorphicReferenceField {
    return field.type === FieldType.POLYMORPHIC_REFERENCE;
}
