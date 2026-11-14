import Link from "next/link";
import EfficientFrontierApp from "./components/EfficientFrontierApp";

// Fully client-side workspace: wallets live in localStorage, prices are
// fetched through /api/market-data/* and all maths runs in a Web Worker.
export default function EfficientFrontierPage() {
  return (
    <main id="main-content" className="flex flex-1 flex-col">
      <header className="mx-auto w-full max-w-[1800px] px-3 pt-4 sm:px-5 sm:pt-5">
        <nav aria-label="Breadcrumb" className="mb-1 flex gap-1.5 text-[11px] text-zinc-500">
          <Link href="/" className="hover:text-zinc-300">
            Triangle Terminal
          </Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page" className="text-zinc-400">
            Efficient Frontier
          </span>
        </nav>
        <h1 className="text-lg font-bold text-white sm:text-xl">Efficient Frontier &amp; Portfolio Optimization</h1>
        <p className="text-xs text-zinc-500">
          Markowitz mean–variance optimisation on historical adjusted prices · runs in your browser · wallets saved locally
        </p>
      </header>
      <EfficientFrontierApp />
    </main>
  );
}
