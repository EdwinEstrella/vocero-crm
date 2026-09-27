"use client";

import { useRouter } from "next/navigation";
import { LogOut, ShieldCheck } from "lucide-react";
import { signOut } from "@/lib/auth/client";

/** Barra fija del panel de plataforma: quién entró y "Cerrar sesión". */
export function AdminHeader({ email }: { email: string }) {
  const router = useRouter();
  return (
    <header className="flex items-center justify-between border-b bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-brand" strokeWidth={1.7} />
        <div>
          <p className="text-[13px] font-semibold leading-tight">Panel de plataforma</p>
          <p className="text-[11px] leading-tight text-text-3">{email}</p>
        </div>
      </div>
      <button
        aria-label="Cerrar sesión"
        title="Cerrar sesión"
        className="flex items-center gap-1.5 rounded px-2 py-1 text-[13px] text-text-3 hover:text-foreground"
        onClick={async () => {
          await signOut();
          router.push("/login");
          router.refresh();
        }}
      >
        <LogOut className="h-4 w-4" strokeWidth={1.7} />
        Cerrar sesión
      </button>
    </header>
  );
}
