import { EmptyState } from "../components/EmptyState";
import { usePageTitle } from "../components/PageTitle";

type ComingSoonPageProps = {
  title: string;
  text: string;
};

// ComingSoonPage is a placeholder for pages that will be built in a later step.
export function ComingSoonPage({ title, text }: ComingSoonPageProps) {
  usePageTitle(title);
  return (
    <EmptyState title={title} headingLevel={1}>
      {text}
    </EmptyState>
  );
}
