/**
 * More details at: https://developer.salesforce.com/docs/atlas.en-us.234.0.api.meta/api/sforce_api_calls_describesobjects_describesobjectresult.htm
 * Generated from: https://jvilk.com/MakeTypes/
 */

export type SObjectFieldType =
    | 'string'
    | 'encryptedstring'
    | 'boolean'
    | 'int'
    | 'double'
    | 'date'
    | 'datetime'
    | 'time'
    | 'base64'
    | 'id'
    | 'reference'
    | 'currency'
    | 'textarea'
    | 'percent'
    | 'phone'
    | 'url'
    | 'email'
    | 'combobox'
    | 'picklist'
    | 'multipicklist'
    | 'anyType'
    | 'address'
    | 'location';

export interface DescribeSObjectResult {
    actionOverrides: [];
    activateable: boolean;
    associateEntityType: null;
    associateParentEntity: null;
    childRelationships: SObjectChildRelationship[];
    compactLayoutable: boolean;
    createable: boolean;
    custom: boolean;
    customSetting: boolean;
    deepCloneable: boolean;
    defaultImplementation: null;
    deletable: boolean;
    deprecatedAndHidden: boolean;
    extendedBy: null;
    extendsInterfaces: null;
    feedEnabled: boolean;
    fields: SObjectField[];
    hasSubtypes: boolean;
    implementedBy: null;
    implementsInterfaces: null;
    isInterface: boolean;
    isSubtype: boolean;
    keyPrefix: string;
    label: string;
    labelPlural: string;
    layoutable: boolean;
    listviewable: null;
    lookupLayoutable: null;
    mergeable: boolean;
    mruEnabled: boolean;
    name: string;
    namedLayoutInfos: null[];
    networkScopeFieldName: null;
    queryable: boolean;
    recordTypeInfos: SObjectRecordType[];
    replicateable: boolean;
    retrieveable: boolean;
    searchLayoutable: boolean;
    searchable: boolean;
    sobjectDescribeOption: string;
    supportedScopes: SObjectSupportedScopes[];
    triggerable: boolean;
    undeletable: boolean;
    updateable: boolean;
    urls: {
        compactLayouts: string;
        rowTemplate: string;
        approvalLayouts: string;
        uiDetailTemplate: string;
        uiEditTemplate: string;
        listviews: string;
        describe: string;
        uiNewRecord: string;
        quickActions: string;
        layouts: string;
        sobject: string;
    };
}

export interface SObjectChildRelationship {
    cascadeDelete: boolean;
    childSObject: string;
    deprecatedAndHidden: boolean;
    field: string;
    junctionIdListNames: null[];
    junctionReferenceTo: null[];
    relationshipName: string | null;
    restrictedDelete: boolean;
}

export interface SObjectField {
    aggregatable: boolean;
    aiPredictionField: boolean;
    autoNumber: boolean;
    byteLength: number;
    calculated: boolean;
    calculatedFormula: null;
    cascadeDelete: boolean;
    caseSensitive: boolean;
    compoundFieldName: string | null;
    controllerName: null;
    createable: boolean;
    custom: boolean;
    defaultValue: boolean | null;
    defaultValueFormula: null;
    defaultedOnCreate: boolean;
    dependentPicklist: boolean;
    deprecatedAndHidden: boolean;
    digits: number;
    displayLocationInDecimal: boolean;
    encrypted: boolean;
    externalId: boolean;
    extraTypeInfo: string | null;
    filterable: boolean;
    filteredLookupInfo: null;
    formulaTreatNullNumberAsZero: boolean;
    groupable: boolean;
    highScaleNumber: boolean;
    htmlFormatted: boolean;
    idLookup: boolean;
    inlineHelpText: null;
    label: string;
    length: number;
    mask: null;
    maskType: null;
    name: string;
    nameField: boolean;
    namePointing: boolean;
    nillable: boolean;
    permissionable: boolean;
    picklistValues: SObjectFieldPicklistValue[];
    polymorphicForeignKey: boolean;
    precision: number;
    queryByDistance: boolean;
    referenceTargetField: null;
    referenceTo: string[];
    relationshipName: string | null;
    relationshipOrder: null;
    restrictedDelete: boolean;
    restrictedPicklist: boolean;
    scale: number;
    searchPrefilterable: boolean;
    soapType: string;
    sortable: boolean;
    type: SObjectFieldType;
    unique: boolean;
    updateable: boolean;
    writeRequiresMasterRead: boolean;
}

export interface SObjectFieldPicklistValue {
    active: boolean;
    defaultValue: boolean;
    label: string;
    validFor: null;
    value: string;
}

export interface SObjectRecordType {
    active: boolean;
    available: boolean;
    defaultRecordTypeMapping: boolean;
    developerName: string;
    master: boolean;
    name: string;
    recordTypeId: string;
    urls: {
        layout: string;
    };
}

export interface SObjectSupportedScopes {
    label: string;
    name: string;
}
