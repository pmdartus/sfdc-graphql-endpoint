import { Connection } from './connection';

import { DescribeSObjectResult } from './types/describe-sobject';
import { SOQLResult } from './types/soql';

export class Api {
    #connection: Connection;
    #version: string;

    constructor({ connection, version = 'v53.0' }: { connection: Connection; version?: string }) {
        this.#connection = connection;
        this.#version = version;
    }

    async describeSObject(sObjectName: string): Promise<DescribeSObjectResult> {
        return this.#connection.fetch(
            `/services/data/${this.#version}/sobjects/${sObjectName}/describe/`,
        );
    }

    async executeSOQL(query: string): Promise<SOQLResult> {
        return this.#connection.fetch(`/services/data/${this.#version}/query/`, {
            searchParams: {
                q: query,
            },
        });
    }

    async explainSOQL(query: string): Promise<SOQLResult> {
        return this.#connection.fetch(`/services/data/${this.#version}/query/`, {
            searchParams: {
                explain: query,
            },
        });
    }
}
