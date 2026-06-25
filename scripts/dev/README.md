# Dev-Only Scripts

Scripts in this directory are **local development helpers only**. They are not part of the production build and should never be run in staging or production environments.

All scripts here enforce `NODE_ENV=development` at runtime and exit immediately if run in any other environment.

| Script | Purpose |
|--------|---------|
| `gen-admin-token.ts` | Generate a local admin JWT for testing admin-only endpoints. |
| `get-dev-user.ts` | Fetch the `dev@keyflow.local` user record from the local database. |
