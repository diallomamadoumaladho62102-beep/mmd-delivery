"use client";
import Link from "next/link";

export default function CreateErrandButton() {
  return (
    <Link href="/orders/create" className="px-3 py-2 rounded bg-black text-white">
      Nouvelle course
    </Link>
  );
}

