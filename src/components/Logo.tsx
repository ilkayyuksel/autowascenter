import { Link } from "@tanstack/react-router";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`flex items-center gap-2 group ${className}`}>
      <div className="relative">
        <div className="h-9 w-9 rounded-xl bg-gradient-primary shadow-elegant flex items-center justify-center transition-transform group-hover:scale-105">
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-primary-foreground" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 17h14M6 13l1.5-4.5A2 2 0 0 1 9.4 7h5.2a2 2 0 0 1 1.9 1.5L18 13M6 13h12v4a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H9v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4Z" />
          </svg>
        </div>
      </div>
      <div className="flex flex-col leading-none">
        <span className="font-bold text-base tracking-tight">Autowascenter</span>
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Sint-Niklaas</span>
      </div>
    </Link>
  );
}
