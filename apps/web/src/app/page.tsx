import AliasCheck from "@/components/AliasCheck";
import TokenDebug from "@/components/TokenDebug";

export default function Page() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6">
      <AliasCheck />

      <TokenDebug />
    </main>
  );
}