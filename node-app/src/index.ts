import { printSchema } from 'graphql';

import { getCredentials, Connection, describeSObject } from './sfdc.js';
import { SchemaBuilder } from './schema-builder.js';

const ENTITIES = ['Account', 'User', 'Lead', 'Opportunity'];

const credentials = getCredentials();
const conn = new Connection(credentials);

const sobject = await Promise.all(ENTITIES.map((entity) => describeSObject(entity, conn)));
const schema = SchemaBuilder.build(sobject);
console.log(printSchema(schema));
