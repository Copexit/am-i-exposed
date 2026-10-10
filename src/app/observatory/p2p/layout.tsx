import { RouteJsonLd } from "@/components/BreadcrumbJsonLd";
import { routeMetadata } from "@/app/seo-routes";

export const metadata = routeMetadata("p2p");

export default function P2pLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RouteJsonLd route="p2p" />
      {children}
    </>
  );
}
