module.exports = {
  apps: [
    {
      name: "keyflow-api",
      cwd: "./apps/server",
      script: "node",
      args: "--import tsx src/main.ts",
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
