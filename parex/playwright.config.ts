import path from 'node:path';

import {
    defineConfig,
    devices,
} from '@playwright/test';

import dotenv from 'dotenv';

import {
    environments,
    TestEnvironment,
} from './config/environments';

const target =
    (process.env.TEST_ENV ?? 'dev') as TestEnvironment;

if (!(target in environments)) {
    throw new Error(
        `TEST_ENV inválido: "${target}". Usa "dev" o "pro".`
    );
}

const environment =
    environments[target];

const parexRoot =
    __dirname;

/*
 * Localmente puede existir:
 *
 *   parex/.env.dev.local
 *   parex/.env.pro.local
 *
 * En GitHub Actions las variables llegan directamente
 * desde Secrets / Environment y estos archivos no existen.
 */
dotenv.config({
    path: path.join(
        parexRoot,
        `.env.${target}.local`
    ),
});

/*
 * La parte sensible de la ceremonia automatizada
 * permanece DEV-only.
 *
 * En PRO podemos ejecutar hasta EUV-UC3-005.
 */
const environmentIgnores =
    target === 'pro'
        ? [
            /EUV-UC3-006\.portal\.spec\.ts$/,
            /EUV-UC3-007\.portal\.spec\.ts$/,
            /EUV-UC3-008\.portal\.spec\.ts$/,
            /EUV-UC3-009\.portal\.spec\.ts$/,
        ]
        : [];

console.log('');
console.log(
    '=========================================='
);
console.log(
    ' PAREX · Frontend Validation'
);
console.log(
    ` Ambiente : ${environment.name.toUpperCase()}`
);
console.log(
    ` URL      : ${environment.baseURL}`
);
console.log(
    '=========================================='
);
console.log('');

export default defineConfig({
    testDir:
        path.join(
            parexRoot,
            'tests'
        ),

    outputDir:
        path.join(
            parexRoot,
            'test-results'
        ),

    timeout:
        30_000,

    workers:
        process.env.CI
            ? 1
            : undefined,

    testIgnore:
        environmentIgnores,

    expect: {
        timeout:
            10_000,
    },

    use: {
        baseURL:
            environment.baseURL,

        trace:
            'retain-on-failure',

        screenshot:
            'only-on-failure',

        video:
            'retain-on-failure',
    },

    projects: [
        {
            name:
                'setup',

            testMatch:
                /.*\.setup\.ts/,

            use: {
                ...devices[
                    'Desktop Chrome'
                ],
            },
        },

        {
            name:
                'portal',

            testMatch:
                /.*\.portal\.spec\.ts/,

            dependencies: [
                'setup',
            ],

            use: {
                ...devices[
                    'Desktop Chrome'
                ],

                storageState:
                    path.join(
                        parexRoot,
                        '.auth',
                        `${target}-user.json`
                    ),
            },
        },

        {
            name:
                'public',

            testMatch:
                /.*\.public\.spec\.ts/,

            use: {
                ...devices[
                    'Desktop Chrome'
                ],
            },
        },
    ],

    reporter: [
        [
            'list',
        ],

        [
            'html',
            {
                open:
                    'never',

                outputFolder:
                    path.join(
                        parexRoot,
                        'playwright-report'
                    ),
            },
        ],

        [
            'json',
            {
                outputFile:
                    path.join(
                        parexRoot,
                        'test-results',
                        'parex-results.json'
                    ),
            },
        ],
    ],
});
