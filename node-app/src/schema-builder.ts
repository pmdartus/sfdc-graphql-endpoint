import {
    assertObjectType,
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
    isObjectType,
    Kind,
} from 'graphql';

import { Graph } from './graph';
import { Entity, Field } from './entity';

declare module 'graphql' {
    interface GraphQLObjectTypeExtensions {
        sfdc?: Entity
    }

    interface GraphQLFieldExtensions<_TSource, _TContext, _TArgs = any> {
        sfdc?: Field
    }
}

const BUILTIN_SCALAR_TYPES = {
    id: GraphQLID,
    string: GraphQLString,
    boolean: GraphQLBoolean,
    int: GraphQLInt,
    double: GraphQLFloat,
    date: new GraphQLScalarType({ name: 'Date' }),
    datetime: new GraphQLScalarType({ name: 'DateTime' }),
    base64: new GraphQLScalarType({ name: 'Base64' }),
    currency: new GraphQLScalarType({ name: 'Currency' }),
    textarea: new GraphQLScalarType({ name: 'TextArea' }),
    percent: new GraphQLScalarType({ name: 'Percent' }),
    phone: new GraphQLScalarType({ name: 'Phone' }),
    url: new GraphQLScalarType({ name: 'URL' }),
    email: new GraphQLScalarType({ name: 'Email' }),
    combobox: new GraphQLScalarType({ name: 'Combobox' }),
    anyType: new GraphQLScalarType({ name: 'AnyType' }),
    
    picklist: GraphQLString,
    multipicklist: new GraphQLList(GraphQLString)
};

export class SchemaBuilder {
    graph: Graph;
    graphQLTypes: Map<string, GraphQLObjectType> = new Map();
    graphQLScalars: Map<string, GraphQLScalarType> = new Map();

    constructor(graph: Graph) {
        this.graph = graph;
    }

    buildSchema(): GraphQLSchema {
        const types = this.#buildTypes();
        const query = this.#buildQuery();

        return new GraphQLSchema({
            types: Array.from(types.values()),
            query,
        });
    }

    #buildTypes(): Map<string, GraphQLObjectType> {
        const entries = this.graph.entities.map((entity) => {
            const { gqlName, fields } = entity;

            return new GraphQLObjectType({
                name: gqlName,
                fields: () => {
                    return Object.fromEntries(
                        fields.map((field) => {
                            const config = this.#buildField(entity, field);
                            return [field.gqlName, config];
                        }),
                    );
                },
                extensions: {
                    sfdc: entity
                }
            });
        });

        const types = (this.graphQLTypes = new Map(entries.map((entry) => [entry.name, entry])));
        return types;
    }

    #buildQuery(): GraphQLObjectType {
        return new GraphQLObjectType({
            name: 'Query',
            fields: () => {
                const queries: Record<string, GraphQLFieldConfig<any, any>> = {};

                for (const entity of this.graph.entities) {
                    if (!entity.config.queryable) {
                        continue;
                    }

                    const gqlEntityType = this.graphQLTypes.get(entity.gqlName)!;

                    queries[`${entity.gqlName}_by_id`] = {
                        type: gqlEntityType,
                        args: {
                            id: {
                                type: GraphQLID,
                            },
                        },
                        resolve(source, args, context, info) {
                            const type = assertObjectType(info.returnType);

                            const fields = info.fieldNodes[0].selectionSet?.selections.map(selectionNode => {
                                if (selectionNode.kind === Kind.FIELD) {
                                    const gqlName = selectionNode.name.value;
                                    return type.getFields()[gqlName].extensions.sfdc!.sfdcName;
                                }
                            }) ?? [];

                            const sfdcEntityName = type.extensions.sfdc!.sfdcName;

                            const query = `SELECT ${fields.join(', ')} FROM ${sfdcEntityName}`;

                            console.log(query)

                            // for (const field of info.fieldNodes) {
                                
                            //     console.log('!!!!', field.name, field.selectionSet?.selections);
                            //     if (isObjectType(info.returnType)) {
                            //         console.log(info.returnType.getFields());

                            //     }
                            // }
                        },
                        extensions: {
                            // sfdc: entity
                        },
                    };

                    queries[entity.gqlName] = {
                        type: new GraphQLList(gqlEntityType),
                        args: {
                            limit: {
                                type: new GraphQLNonNull(GraphQLInt),
                            },
                            offset: {
                                type: GraphQLInt,
                            },
                        },
                        extensions: {
                            // sfdc: entity
                        },
                    };
                }

                return queries;
            },
        });
    }

    #buildField(entity: Entity, field: Field): GraphQLFieldConfig<any, any> {
        let type: GraphQLOutputType;

        switch (field.type) {
            case 'id':
            case 'string':
            case 'boolean':
            case 'int':
            case 'double':
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
            case 'picklist':
            case 'multipicklist':
                {
                    type = BUILTIN_SCALAR_TYPES[field.type];
                }
                break;

            case 'reference': {
                const { referenceTo } = field;

                if (referenceTo.length === 1 && this.graph.entityBySfdcName(referenceTo[0])) {
                    const referencedEntity = this.graph.entityBySfdcName(referenceTo[0])!;
                    type = this.graphQLTypes.get(referencedEntity.gqlName)!;
                } else {
                    type = GraphQLID;
                }
            }
        }

        if (!field.config.nillable) {
            type = new GraphQLNonNull(type);
        }

        return {
            type,
            extensions: {
                sfdc: field
            }
        };
    }
}
