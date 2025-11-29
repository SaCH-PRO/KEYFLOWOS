import type { Meta, StoryObj } from "@storybook/react";
import { MomentumBar } from "./momentum-bar";

const meta: Meta<typeof MomentumBar> = {
  title: "Lumenflow/MomentumBar",
  component: MomentumBar,
  args: {
    value: 0.6,
    label: "Flow Momentum",
    streaks: ["Follow-up streak 3d", "7 invoices confirmed"],
  },
};

export default meta;
type Story = StoryObj<typeof MomentumBar>;

export const Default: Story = {};
