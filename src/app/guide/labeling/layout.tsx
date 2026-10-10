import { RouteJsonLd } from "@/components/BreadcrumbJsonLd";
import { routeMetadata } from "@/app/seo-routes";

export const metadata = routeMetadata("labeling");

export default function LabelingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RouteJsonLd route="labeling" />
      {children}
    </>
  );
}
