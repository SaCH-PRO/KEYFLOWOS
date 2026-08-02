module.exports = {
  apps: [
    {
      name: "keyflow-api",
      cwd: "./apps/server",
      // Compiled output, not tsx. tsx does not emit `design:paramtypes`, so
      // NestJS type-based dependency injection fails: `tsx src/main.ts`
      // produces 64 "undefined dependency" errors, maps 0 routes and exits
      // non-zero. This holds regardless of NODE_ENV.
      //
      // Every script in apps/server/package.json (dev, start, start:prod)
      // already runs `node dist/main.js`; this file was the outlier. Run
      // `pnpm --filter server build` before starting.
      script: "node",
      args: "dist/main.js",
      env: {
        NODE_ENV: "development",
      },
      watch: false,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "../../logs/api-error.log",
      out_file: "../../logs/api-out.log",
      merge_logs: true,
    },
    {
      name: "keyflow-web",
      cwd: "./apps/web",
      script: "node",
      args: "node_modules/next/dist/bin/next dev -H 0.0.0.0 -p 5000",
      env: {
        NODE_ENV: "development",
      },
      watch: false,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "../../logs/web-error.log",
      out_file: "../../logs/web-out.log",
      merge_logs: true,
    },
  ],
};
