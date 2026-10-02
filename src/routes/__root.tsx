import {
  Outlet,
  Link,
  createRootRoute,
  HeadContent,
  Scripts,
  useLocation,
} from "@tanstack/react-router";
import { AdminAuthProvider } from "@/components/admin/AdminAuthProvider";
import { Toaster } from "@/components/ui/sonner";
import { SITE } from "@/lib/site";

import appCss from "../styles.css?url";

// Social preview image, served by this app from public/og-image.jpg. Crawlers need an
// absolute URL, so it is built from the site's own domain (no externally hosted asset).
const OG_IMAGE_URL = `https://${SITE.domain}/og-image.jpg`;

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Autowascenter — Premium Auto Detailing in Sint-Niklaas" },
      { name: "description", content: "Premium auto detailing in Sint-Niklaas. Handwas, interieurreiniging, keramische coating en meer. Reserveer eenvoudig online." },
      { name: "author", content: "Autowascenter" },
      { name: "theme-color", content: "#5170ff" },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "nl_BE" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:title", content: "Autowascenter — Premium Auto Detailing in Sint-Niklaas" },
      { name: "twitter:title", content: "Autowascenter — Premium Auto Detailing in Sint-Niklaas" },
      { property: "og:description", content: "Premium auto detailing in Sint-Niklaas. Handwas, interieurreiniging, keramische coating en meer. Reserveer eenvoudig online." },
      { name: "twitter:description", content: "Premium auto detailing in Sint-Niklaas. Handwas, interieurreiniging, keramische coating en meer. Reserveer eenvoudig online." },
      { property: "og:image", content: OG_IMAGE_URL },
      { name: "twitter:image", content: OG_IMAGE_URL },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

const isAdminPath = (pathname: string) =>
  pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/admin-login";

function RootComponent() {
  const { pathname } = useLocation();
  return (
    <>
      {/* Auth0 only for the admin area; the public site never loads or contacts Auth0. */}
      {isAdminPath(pathname) ? (
        <AdminAuthProvider>
          <Outlet />
        </AdminAuthProvider>
      ) : (
        <Outlet />
      )}
      <Toaster richColors position="top-center" />
    </>
  );
}
