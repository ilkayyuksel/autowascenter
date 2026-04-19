import { Car, CarFront, Truck, Caravan, Bus, type LucideIcon } from "lucide-react";

/**
 * Map a vehicle type slug or icon-key to a Lucide icon.
 * Beheerder kan in admin de slug instellen (bv. "kleine-auto", "suv", "bestelwagen", "camper").
 */
export function getVehicleIcon(key?: string | null): LucideIcon {
  const k = (key ?? "").toLowerCase();
  if (k.includes("camper") || k.includes("caravan")) return Caravan;
  if (k.includes("bus")) return Bus;
  if (k.includes("bestel") || k.includes("pick") || k.includes("vrachtwagen") || k.includes("truck")) return Truck;
  if (k.includes("suv") || k.includes("crossover") || k.includes("4x4")) return CarFront;
  if (k.includes("luxe") || k.includes("sedan") || k.includes("break") || k.includes("station")) return CarFront;
  return Car;
}
