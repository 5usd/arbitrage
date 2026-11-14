import type { Metadata } from "next";
import "./efficient-frontier.css";

export const metadata: Metadata = {
  title: "Arbitrage — Efficient Frontier & Portfolio Optimizer",
  description:
    "Open-source Markowitz efficient frontier: build portfolios from historical adjusted prices and optimise for minimum variance, maximum Sharpe, target return or target risk — in your browser.",
};

export default function EfficientFrontierLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="flex flex-1 flex-col bg-[#080d15] text-[#b6c3d6]">{children}</div>;
}
