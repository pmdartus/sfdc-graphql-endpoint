import url from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import child_process from 'node:child_process';

import { fetch } from 'undici';

const API_VERSION = 'v53.0';
const ENTITIES = [
    'Account',
    'User',
    'Lead',
    'Opportunity'
]

function getCredentials() {
    if (process.env.INSTANCE_URL && process.env.ACCESS_TOKEN) {
        return {
            accessToken: process.env.ACCESS_TOKEN,
            instanceUrl: process.env.INSTANCE_URL,
        };
    } else {
        console.log('Retrieving instance URL and access token.');

        const output = child_process.execSync('sfdx force:user:display --json', {
            cwd: path.dirname(url.fileURLToPath(import.meta.url)),
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

/**
 * @param {String} str A random string
 * @returns A file name safely encoded
 */
function safeFileName(str) {
    return str.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

class Connection {
    #instanceUrl;
    #accessToken;
    #cacheDir = path.resolve(url.fileURLToPath(import.meta.url), '../.cache');

    constructor({ instanceUrl, accessToken }) {
        this.#instanceUrl = instanceUrl;
        this.#accessToken = accessToken;
    }

    async fetch(endpoint) {
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

    async #fetch(endpoint) {
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

/**
 * Use the sObject Describe resource to retrieve all the metadata for an object, including
 * information about each field, URLs, and child relationships.
 * https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_sobject_describe.htm
 *
 * @param {String} name
 * @param {Connection} conn
 * @returns The metadata associated with SObject
 */
async function describeSObject(name, conn) {
    return conn.fetch(`/services/data/${API_VERSION}/sobjects/${name}/describe/`);
}

const credentials = getCredentials();
const conn = new Connection(credentials);

await Promise.allSettled(ENTITIES.map(entity => describeSObject(entity, conn)));