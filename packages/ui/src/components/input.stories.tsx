import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "./input";

const meta: Meta<typeof Input> = {
  title: "Lumenflow/Input",
  component: Input,
  args: {
    label: "Email",
    placeholder: "you@example.com",
    hint: "We’ll use this to confirm your booking",
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {};
