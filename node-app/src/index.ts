import { printSchema, assertValidSchema, graphql } from 'graphql';

import { getCredentials, Connection, describeSObject } from './sfdc.js';
import { SchemaBuilder } from './schema-builder.js';
import { Graph } from './graph.js';

const ENTITIES = ['Account', 'User', 'Lead', 'Opportunity'];

const credentials = getCredentials();
const conn = new Connection(credentials);

const sObjects = await Promise.all(ENTITIES.map((entity) => describeSObject(entity, conn)));

const graph = new Graph(sObjects);
const schemaBuilder = new SchemaBuilder(graph);

const schema = schemaBuilder.buildSchema();
assertValidSchema(schema);
