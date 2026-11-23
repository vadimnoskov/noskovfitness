import postgres from 'postgres';

const url = process.env.DATABASE_URL ?? 'postgres://nf:nf@localhost:5432/noskovfitness';
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
/** Hosted Postgres (Replit/Neon) requires TLS; the local development database does not. */
export const sql = postgres(url, { onnotice: () => {}, ssl: local ? false : 'require', max: 5 });
