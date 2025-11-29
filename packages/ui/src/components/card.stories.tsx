import type { Meta, StoryObj } from "@storybook/react";
import { Card } from "./card";

const meta: Meta<typeof Card> = {
  title: "Lumenflow/Card",
  component: Card,
  args: {
    title: "Bookings Module",
    badge: "Studio",
    children: <p className="text-sm text-[var(--kf-text-muted)]">Configure public booking flows.</p>,
  },
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {};
