import * as url from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as child_process from 'node:child_process';

import { fetch } from 'undici';

import { DescribeSObjectResult } from './types/describe-sobject';

const API_VERSION = 'v53.0';

interface Credentials {
    accessToken: string;
    instanceUrl: string;
}

export function getCredentials(): Credentials {
    if (process.env.INSTANCE_URL && process.env.ACCESS_TOKEN) {
        return {
            accessToken: process.env.ACCESS_TOKEN,
            instanceUrl: process.env.INSTANCE_URL,
        };
    } else {
        console.log('Retrieving instance URL and access token.');

        const output = child_process.execSync('sfdx force:user:display --json', {
            cwd: path.dirname(url.fileURLToPath(import.meta.url)),
            encoding: 'utf-8',
        });

        const { accessToken, instanceUrl } = JSON.parse(output).result;

        console.log(
            `ACCESS_TOKEN="${accessToken.replace('!', '\\!')}" INSTANCE_URL="${instanceUrl}"`,
        );
        return {
            accessToken,
            instanceUrl,
        };
    }
}

export class Connection {
    #instanceUrl;
    #accessToken;
    #cacheDir = path.resolve(url.fileURLToPath(import.meta.url), '../.cache');

    constructor({ instanceUrl, accessToken }: Credentials) {
        this.#instanceUrl = instanceUrl;
        this.#accessToken = accessToken;
    }

    async fetch(endpoint: string) {
        const cache = path.resolve(this.#cacheDir, `${safeFileName(endpoint)}.json`);

        let txt;
        try {
            txt = await fs.readFile(cache, 'utf-8');
        } catch (error) {
            txt = await this.#fetch(endpoint);

            await this.#ensureCacheDir();
            await fs.writeFile(cache, txt);
        }

        return JSON.parse(txt);
    }

    async #ensureCacheDir() {
        try {
            await fs.access(this.#cacheDir);
        } catch {
            await fs.mkdir(this.#cacheDir, { recursive: true });
        }
    }

    async #fetch(endpoint: string) {
        const response = await fetch(this.#instanceUrl + endpoint, {
            headers: {
                Authorization: `Bearer ${this.#accessToken}`,
            },
        });

        const txt = await response.text();

        if (response.status !== 200) {
            const message = `Failed to fetch "${endpoint}" (status code ${response.status})`;

            console.error(message);
            console.error(`Body:\n${txt}`);

            throw new Error(message);
        }

        return txt;
    }
}

function safeFileName(str: string): string {
    return str.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

export async function describeSObject(
    name: string,
    conn: Connection,
): Promise<DescribeSObjectResult> {
    return conn.fetch(`/services/data/${API_VERSION}/sobjects/${name}/describe/`);
}
