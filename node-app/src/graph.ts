import { createEntity, Entity } from "./entity.js";
import { DescribeSObjectResult } from "./sfdc/types/describe-sobject.js";

export class Graph {
    readonly entities: Entity[];

    constructor(sObjects: DescribeSObjectResult[]) {
        this.entities = sObjects.map(sObject => createEntity(sObject));
    }

    entityByGqlName(name: string): Entity | undefined {
        return this.entities.find(entity => entity.gqlName === name);
    }

    entityBySfdcName(name: string): Entity | undefined {
        return this.entities.find(entity => entity.sfdcName === name);
    }
}