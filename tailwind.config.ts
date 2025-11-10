import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./apps/web/src/**/*.{js,ts,jsx,tsx,mdx}",
    "./packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
export default config;