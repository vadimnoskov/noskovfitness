---
name: API code generation
description: A naming collision between generated query types and path validation schemas.
---

Avoid an operation that combines path parameters and query parameters when the generated TypeScript query type and Zod path schema both receive the operation's `Params` name.

**Why:** The current Orval configuration re-exports both generated modules. An endpoint with a screen path parameter and date query parameters generated duplicate exports, causing the library build to fail even though code generation succeeded.

**How to apply:** Prefer a query-only screen selector for screen-data reads, or explicitly resolve the generator's naming strategy before adding mixed path/query operations. Run the complete codegen command, including its library build, to catch collisions.
