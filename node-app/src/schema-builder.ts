import {
    GraphQLBoolean,
    GraphQLEnumType,
    GraphQLFieldConfig,
    GraphQLFloat,
    GraphQLID,
    GraphQLInt,
    GraphQLList,
    GraphQLNonNull,
    GraphQLObjectType,
    GraphQLOutputType,
    GraphQLScalarType,
    GraphQLSchema,
    GraphQLString,
} from 'graphql';

import { DescribeSObjectResult, SObjectField } from './types/describe-sobject';

function toGraphQLFieldName(str: string): string {
    return str[0].toLowerCase() + str.slice(1);
}

function toGraphQLEnumFieldName(str: string): string {
    return str.toUpperCase().replace(/[^_a-zA-Z0-9]/g, '_');
}

export class SchemaBuilder {
    sObjects: Map<string, DescribeSObjectResult>;
    graphQLTypes: Map<string, GraphQLObjectType>;
    graphQLScalars: Map<string, GraphQLScalarType>;

    constructor(sObjects: DescribeSObjectResult[]) {
        this.sObjects = new Map(sObjects.map((sObject) => [sObject.name, sObject]));
        this.graphQLTypes = new Map();
        this.graphQLScalars = new Map();
    }

    buildSchema(): GraphQLSchema {
        this.#buildTypes();
        const query = this.#buildQuery();
        const mutation = this.#buildMutation();

        return new GraphQLSchema({
            types: Array.from(this.graphQLTypes.values()),
            query,
            // mutation,
        });
    }

    #buildTypes() {
        for (const sObject of this.sObjects.values()) {
            const { name } = sObject;

            const graphQLType = new GraphQLObjectType({
                name,
                fields: () => {
                    return Object.fromEntries(
                        sObject.fields.map((sObjectField) => {
                            const { name, config } = this.#sObjectFieldTypeToGraphQLType(
                                sObject,
                                sObjectField,
                            );
                            return [name, config];
                        }),
                    );
                },
            });

            this.graphQLTypes.set(name, graphQLType);
        }
    }

    #buildQuery(): GraphQLObjectType {
        const queriesById = Array.from(this.graphQLTypes.values()).map(
            (graphQLType): [string, GraphQLFieldConfig<any, any>] => {
                return [
                    `${toGraphQLFieldName(graphQLType.name)}_by_id`,
                    {
                        type: graphQLType,
                        args: {
                            id: {
                                type: GraphQLID,
                            },
                        },
                    },
                ];
            },
        );

        const queryFilter = Array.from(this.graphQLTypes.values()).map(
            (graphQLType): [string, GraphQLFieldConfig<any, any>] => {
                return [
                    toGraphQLFieldName(graphQLType.name),
                    {
                        type: new GraphQLList(graphQLType),
                        args: {
                            limit: {
                                type: new GraphQLNonNull(GraphQLInt),
                            },
                            offset: {
                                type: GraphQLInt,
                            }
                        },
                    },
                ];
            },
        );

        return new GraphQLObjectType({
            name: 'Query',
            fields: Object.fromEntries([...queriesById, ...queryFilter]),
        });
    }

    #buildMutation(): GraphQLObjectType {
        return new GraphQLObjectType({
            name: 'Mutation',
            fields: {}
        });
    }

    #sObjectFieldTypeToGraphQLType(
        sObject: DescribeSObjectResult,
        sObjectField: SObjectField,
    ): { name: string; config: GraphQLFieldConfig<any, any> } {
        let name = toGraphQLFieldName(sObjectField.name);
        let type: GraphQLOutputType;

        switch (sObjectField.type) {
            case 'id':
                type = GraphQLID;
                break;

            case 'string':
                type = GraphQLString;
                break;
            case 'boolean':
                type = GraphQLBoolean;
                break;
            case 'int':
                type = GraphQLInt;
                break;
            case 'double':
                type = GraphQLFloat;
                break;

            case 'date':
            case 'datetime':
            case 'base64':
            case 'currency':
            case 'textarea':
            case 'percent':
            case 'phone':
            case 'url':
            case 'email':
            case 'combobox':
            case 'anyType':
            case 'address':
            case 'location':
                {
                    const scalarName =
                        sObjectField.type[0].toUpperCase() + sObjectField.type.slice(1);

                    if (!this.graphQLScalars.has(scalarName)) {
                        type = new GraphQLScalarType({ name: scalarName });
                        this.graphQLScalars.set(scalarName, type);
                    } else {
                        type = this.graphQLScalars.get(scalarName)!;
                    }
                }
                break;

            case 'picklist':
            case 'multipicklist': {
                const values = Object.fromEntries(
                    sObjectField.picklistValues.map((picklistValue) => {
                        return [
                            toGraphQLEnumFieldName(picklistValue.label),
                            {
                                value: picklistValue.value,
                            },
                        ];
                    }),
                );

                type = new GraphQLEnumType({
                    name: `${sObject.name}_${sObjectField.name}`,
                    values,
                });
                break;
            }

            case 'reference': {
                const { referenceTo } = sObjectField;

                if (referenceTo.length === 1 && this.graphQLTypes.has(referenceTo[0])) {
                    type = this.graphQLTypes.get(referenceTo[0])!;
                } else {
                    type = GraphQLID;
                }

                if (name.endsWith('Id')) {
                    name = name.slice(0, -2);
                }
            }
        }

        if (!sObjectField.nillable) {
            type = new GraphQLNonNull(type);
        }

        return {
            name,
            config: {
                type,
            },
        };
    }

    static build(sObjects: DescribeSObjectResult[]) {
        const schemaBuilder = new SchemaBuilder(sObjects);

        return schemaBuilder.buildSchema();
    }
}
