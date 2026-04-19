import { Link } from "@tanstack/react-router";
import logoImg from "@/assets/logo.png";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`flex items-center group ${className}`}>
      <img
        src={logoImg}
        alt="Autowascenter Sint-Niklaas"
        className="h-10 sm:h-11 w-auto transition-transform group-hover:scale-[1.02]"
      />
    </Link>
  );
}
