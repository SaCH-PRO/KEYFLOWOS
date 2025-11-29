import type { Meta, StoryObj } from "@storybook/react";
import { FlowFeed } from "./flow-feed";

const meta: Meta<typeof FlowFeed> = {
  title: "Lumenflow/FlowFeed",
  component: FlowFeed,
  args: {
    items: [
      { id: "1", icon: "💸", text: "Invoice #004 paid — confirming booking…", timestamp: "08:24", tone: "success" },
      { id: "2", icon: "🗓️", text: "Booking created for Sarah — 3:00 PM", timestamp: "08:21" },
      { id: "3", icon: "⚡", text: "Automation executed: Review Request Flow", timestamp: "08:18", tone: "info" },
    ],
  },
};

export default meta;
type Story = StoryObj<typeof FlowFeed>;

export const Default: Story = {};
