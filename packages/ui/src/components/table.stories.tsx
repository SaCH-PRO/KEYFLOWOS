import type { Meta, StoryObj } from "@storybook/react";
import { Table } from "./table";

const meta: Meta<typeof Table> = {
  title: "Lumenflow/Table",
  component: Table,
  args: {
    headers: ["Name", "Email", "Status"],
    rows: [
      ["Sarah Smith", "sarah@example.com", "Active"],
      ["John Doe", "john@example.com", "Lead"],
    ],
  },
};

export default meta;
type Story = StoryObj<typeof Table>;

export const Default: Story = {};
