"use client";

import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/client";

export function SuspendedNotice() {
  const router = useRouter();
  return (
    <div className="w-full max-w-sm rounded-lg border bg-card p-6 text-center">
      <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-danger-text" strokeWidth={1.7} />
      <h1 className="text-base font-semibold">Tu cuenta está suspendida</h1>
      <p className="mt-2 text-sm text-text-3">Contacta a soporte.</p>
      <Button
        className="mt-5"
        variant="outline"
        onClick={async () => {
          await signOut().catch(() => {});
          router.push("/login");
          router.refresh();
        }}
      >
        Cerrar sesión
      </Button>
    </div>
  );
}
