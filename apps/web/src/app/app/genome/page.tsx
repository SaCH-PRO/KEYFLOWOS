import { Metadata } from "next";
import { GenomeHubShell } from "./components/genome-hub-shell";

export const metadata: Metadata = {
  title: "Business Genome — KEYFLOWOS",
  description: "Your consolidated business genome hub.",
};

export default function GenomePage() {
  return <GenomeHubShell />;
}
