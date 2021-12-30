import * as path from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import * as child_process from 'node:child_process';

import { fetch } from 'undici';

interface ConnectionConfig {
    instanceUrl: string; 
    accessToken: string
}

export class Connection {
    #instanceUrl;
    #accessToken;

    constructor({ instanceUrl, accessToken }: ConnectionConfig) {
        this.#instanceUrl = instanceUrl;
        this.#accessToken = accessToken;
    }

    async fetch<T>(endpoint: string, options?: {
        searchParams?: Record<string, string>
    }): Promise<T> {
        const url = new URL(endpoint, this.#instanceUrl);
        
        if (options?.searchParams) {
            for (const [name, value] of Object.entries(options.searchParams)) {
                url.searchParams.set(name, value);
            }
        }

        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${this.#accessToken}`,
            },
        });

        const res = await response.json();

        if (response.status !== 200) {
            let message = `Failed to fetch "${url.toString()}" (status code ${response.status})`;
            message += `Body:\n${JSON.stringify(res)}`;

            console.error(message);
            throw new Error(message);
        }

        return res as T;
    }

    static getConnection(): Connection {
        let config: ConnectionConfig;

        if (process.env.INSTANCE_URL && process.env.ACCESS_TOKEN) {
            config = {
                accessToken: process.env.ACCESS_TOKEN,
                instanceUrl: process.env.INSTANCE_URL,
            };
        } else {    
            const output = child_process.execSync('sfdx force:user:display --json', {
                cwd: path.dirname(fileURLToPath(import.meta.url)),
                encoding: 'utf-8',
            });
    
            const { accessToken, instanceUrl } = JSON.parse(output).result;

            config = {
                accessToken,
                instanceUrl,
            };
        }

        return new Connection(config);
    }
}


