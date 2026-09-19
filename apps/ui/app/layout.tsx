import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./ui.css";
import "./shell-fixes.css";
import "./concept-mockup.css";

export const metadata: Metadata = {
  title: "Kairo — New UI",
  description: "Kairo content intelligence workspace",
};

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
