// Minimal ambient module declarations to keep editor/tsserver noise down.
// This project uses CommonJS Netlify Functions with some libraries that
// don't ship TypeScript types.

declare module 'uuid';
declare module 'nodemailer';
declare module 'multiparty';
