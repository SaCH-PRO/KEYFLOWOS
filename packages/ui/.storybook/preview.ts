import "../src/styles/tokens.css";
import type { Preview } from "@storybook/react";

const preview: Preview = {
  parameters: {
    layout: "centered",
    backgrounds: {
      default: "neo",
      values: [
        { name: "neo", value: "#0D0D0E" },
        { name: "light", value: "#ffffff" },
      ],
    },
  },
};

export default preview;
