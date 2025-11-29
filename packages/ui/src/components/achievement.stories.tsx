import type { Meta, StoryObj } from "@storybook/react";
import { AchievementCapsule } from "./achievement";

const meta: Meta<typeof AchievementCapsule> = {
  title: "Lumenflow/AchievementCapsule",
  component: AchievementCapsule,
  args: {
    title: "🚀 First Sale Completed",
    description: "Momentum rising. Keep the flow.",
  },
};

export default meta;
type Story = StoryObj<typeof AchievementCapsule>;

export const Info: Story = {};
export const Success: Story = { args: { tone: "success", title: "✅ Flow Unlocked" } };
export const Danger: Story = { args: { tone: "danger", title: "⚠️ Attention Needed" } };
