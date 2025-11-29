import type { StorybookConfig } from "@storybook/react-vite";
import { dirname, join } from "node:path";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-essentials", "@storybook/addon-interactions"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  viteFinal: async (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@keyflow/ui": join(dirname(__dirname), "src"),
    };
    return config;
  },
};

export default config;
