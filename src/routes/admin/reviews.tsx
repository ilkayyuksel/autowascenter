import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/reviews")({
  beforeLoad: () => {
    throw redirect({ to: "/admin" });
  },
});
