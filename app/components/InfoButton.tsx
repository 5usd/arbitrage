import Link from "next/link";
import { Info } from "lucide-react";
export default function InfoButton({className,iconClassName="h-4 w-4"}:{slug:string;className?:string;iconClassName?:string}){return <Link href="/docs" aria-label="View scanner documentation" className={className ?? "rounded-lg border border-zinc-800 p-2 text-zinc-400"}><Info className={iconClassName}/></Link>;}
