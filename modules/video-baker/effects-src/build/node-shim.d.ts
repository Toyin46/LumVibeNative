// Minimal ambient declarations for the two Node 'fs' functions
// compile-manifest.ts uses. A real project should just
// `npm install -D @types/node` instead — this file exists only so the
// build script type-checks in environments without npm registry access
// (like this one). Delete it once @types/node is installed for real.
declare module "fs" {
  export function writeFileSync(path: string, data: string): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
}
