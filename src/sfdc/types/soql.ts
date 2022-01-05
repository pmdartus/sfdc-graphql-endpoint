/**
 * More details at: https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_query.htm
 */

export interface SOQLResult {
    done: boolean;
    totalSize: number;
    nextRecordsUrl?: string;
    records: SOQLRecord[];
}

export interface SOQLRecord {
    attributes: {
        type: string;
        url: string;
    };
    [field: string]: unknown;
}
