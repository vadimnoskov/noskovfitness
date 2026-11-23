---
name: PostgreSQL transport settings
description: Why the imported hosted-database TLS assumption does not apply to the development database proxy.
---

Respect the PostgreSQL connection string's TLS settings rather than forcing TLS for every hostname other than localhost.

**Why:** The imported client assumed every remote-looking hostname was a TLS-enabled hosted server. Replit's development database proxy reset those connections even though the default PostgreSQL client connected successfully.

**How to apply:** Keep transport requirements in the connection configuration. When configuring an external hosted database, explicitly include the provider's required TLS settings rather than guessing from its hostname.
