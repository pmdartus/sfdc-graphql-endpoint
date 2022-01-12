import url from 'node:url';
import path from 'node:path';
import child_process from 'node:child_process';
import { IncomingHttpHeaders } from 'node:http';

import { FastifyInstance } from 'fastify';

import app from '../src/http/app.js';

export function gql(parts: TemplateStringsArray, ...args: any[]): string {
    let str = '';

    for (let i = 0; i < args.length; i++) {
        str += parts[i] + String(args[i]);
    }

    return str + parts[parts.length - 1];
}

export function getApp({ entities }: { entities: string[] }): FastifyInstance {
    let instanceUrl;
    let accessToken;

    try {
        // Jest automatically force output colorization, which breaks SFDX output JSON parsing.
        // Unsetting the `FORCE_COLOR` environment variable to make the SFDX command produce plain
        // JSON output.
        const env = {
            ...process.env,
            FORCE_COLOR: undefined,
        };

        const output = child_process.execSync('sfdx force:user:display --json', {
            cwd: path.resolve(url.fileURLToPath(import.meta.url), '../sfdx-org'),
            encoding: 'utf-8',
            env,
        });

        const { result } = JSON.parse(output);
        instanceUrl = result.instanceUrl;
        accessToken = result.accessToken;
    } catch (error: any) {
        console.error('Failed to retrieve the scratch org information.');
        throw error;
    }

    return app({
        instanceUrl,
        accessToken,
        entities,
    });
}

export async function executeQuery({
    app,
    query,
    variables = {},
    headers = {},
}: {
    app: FastifyInstance;
    query: string;
    variables?: Record<string, unknown>
    headers?: IncomingHttpHeaders
}): Promise<any> {
    const response = await app.inject({
        method: 'POST',
        url: '/graphql',
        headers,
        payload: {
            query,
            variables
        },
    });

    if (response.statusCode !== 200) {
        console.error('Invalid response', response.body);
    }

    expect(response.statusCode).toBe(200);
    return response.json();
}
