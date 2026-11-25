declare module '*.gz' {
  /** Base64 text of the file (esbuild base64 loader). */
  const base64: string;
  export default base64;
}
