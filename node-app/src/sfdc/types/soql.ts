export interface SOQLResult {
    done: boolean;
    totalSize: number;
    nextRecordsUrl?: string;
    record: SOQLRecord[];
}

export interface SOQLRecord {
    attributes: {
        type: string;
        url: string;
    };
    [field: string]: unknown;
}
