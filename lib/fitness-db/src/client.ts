import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required.');
/** Respect DATABASE_URL's TLS settings; the managed development proxy may not speak TLS. */
export const sql = postgres(url, { onnotice: () => {}, max: 5 });
