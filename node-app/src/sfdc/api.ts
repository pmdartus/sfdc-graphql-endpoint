import { Connection } from "./connection";

import { DescribeSObjectResult } from "./types/describe-sobject";
import { SOQLResult } from "./types/soql";

const API_VERSION = 'v53.0';

export async function describeSObject(
    conn: Connection,
    sObjectName: string,
): Promise<DescribeSObjectResult> {
    return conn.fetch(`/services/data/${API_VERSION}/sobjects/${sObjectName}/describe/`);
}

export async function executeSOQL(
    conn: Connection,
    query: string,
): Promise<SOQLResult> {
    return conn.fetch(`/services/data/${API_VERSION}/query/`, {
        searchParams: {
            q: query
        }
    });
}