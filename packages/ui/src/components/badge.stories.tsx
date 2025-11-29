import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "./badge";

const meta: Meta<typeof Badge> = {
  title: "Lumenflow/Badge",
  component: Badge,
  args: { children: "Momentum Rising" },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {};
export const Success: Story = { args: { tone: "success", children: "First Sale" } };
export const Warning: Story = { args: { tone: "warning", children: "Pending Action" } };
export const Danger: Story = { args: { tone: "danger", children: "Overdue" } };
export const Info: Story = { args: { tone: "info", children: "Flow Event" } };
