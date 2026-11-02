import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {title:"Arbitrage — Triangular Scanner",description:"Open-source, read-only triangular arbitrage research scanner."};
export default function Layout({children}: {children: React.ReactNode}){return <html lang="en"><body className="min-h-screen bg-[#0a0a0a] text-white"><div className="border-b border-zinc-800 px-4 py-2 text-xs text-zinc-400">Research scanner · indicative quotes after configured fees · no order execution</div><div className="flex min-h-screen flex-col">{children}</div></body></html>;}
