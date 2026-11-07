export type TestEnvironment = 'dev' | 'staging' | 'pro';

export const environments = {
    dev: {
        name: 'dev',
        baseURL: 'https://dh2eew9mcxlzx.cloudfront.net',
    },

    staging: {
        name: 'staging',
        baseURL: 'https://d199n4241b95rg.cloudfront.net',
    },

    pro: {
        name: 'pro',
        baseURL: 'https://d2w8tbr82l6xy9.cloudfront.net',
    },
} as const;