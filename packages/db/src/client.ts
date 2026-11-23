import postgres from 'postgres';
export const sql = postgres(process.env.DATABASE_URL ?? 'postgres://nf:nf@localhost:5432/noskovfitness', { onnotice: () => {} });
