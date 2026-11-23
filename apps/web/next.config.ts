import type { NextConfig } from 'next';
const config: NextConfig = { transpilePackages: ['@nf/core', '@nf/db'], serverExternalPackages: ['postgres'] };
export default config;
