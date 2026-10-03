export type TestEnvironment = 'dev' | 'pro';

export const environments = {
    dev: {
        name: 'dev',
        baseURL: 'https://dh2eew9mcxlzx.cloudfront.net',
    },

    pro: {
        name: 'pro',
        baseURL: 'https://d2w8tbr82l6xy9.cloudfront.net',
    },
} as const;