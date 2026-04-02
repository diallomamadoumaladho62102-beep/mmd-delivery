"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseBrowser";

type Role = "client" | "driver" | "restaurant";

export default function SignupLanding() {
  const router = useRouter();

  const handlePress = async (role: Role) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("selectedRole", role);
    }

    const { data } = await supabase.auth.getSession();
    const isLoggedIn = !!data.session;

    if (!isLoggedIn) {
      if (role === "client") {
        router.push("/auth");
        return;
      }

      if (role === "driver") {
        router.push("/signup/driver");
        return;
      }

      router.push("/signup/restaurant");
      return;
    }

    if (role === "client") {
      router.push("/dashboard");
      return;
    }

    if (role === "driver") {
      router.push("/orders/driver");
      return;
    }

    router.push("/restaurant/profile");
  };

  return (
    <main className="min-h-screen bg-[#020617] px-6 py-10 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-3xl flex-col justify-between">
        <div>
          <h1 className="mb-3 text-5xl font-bold leading-tight tracking-tight max-sm:text-4xl">
            Choose your mode
          </h1>

          <p className="mb-10 max-w-2xl text-xl text-gray-400 max-sm:text-lg">
            Choose a role to access the corresponding interface.
          </p>

          <div className="space-y-6">
            <button
              type="button"
              onClick={() => void handlePress("client")}
              className="w-full rounded-[26px] bg-red-500 px-6 py-6 text-center text-3xl font-semibold text-white transition hover:opacity-95 active:scale-[0.99] max-sm:rounded-2xl max-sm:py-5 max-sm:text-2xl"
            >
              Client
            </button>

            <button
              type="button"
              onClick={() => void handlePress("driver")}
              className="w-full rounded-[26px] bg-sky-500 px-6 py-6 text-center text-3xl font-semibold text-white transition hover:opacity-95 active:scale-[0.99] max-sm:rounded-2xl max-sm:py-5 max-sm:text-2xl"
            >
              Driver
            </button>

            <button
              type="button"
              onClick={() => void handlePress("restaurant")}
              className="w-full rounded-[26px] bg-green-500 px-6 py-6 text-center text-3xl font-semibold text-white transition hover:opacity-95 active:scale-[0.99] max-sm:rounded-2xl max-sm:py-5 max-sm:text-2xl"
            >
              Restaurant
            </button>
          </div>
        </div>

        <div className="flex justify-center pt-12">
          <Image
            src="/brand/mmd-logo.png"
            alt="MMD Delivery Logo"
            width={88}
            height={88}
            priority
            className="h-auto w-auto opacity-95"
          />
        </div>
      </div>
    </main>
  );
}