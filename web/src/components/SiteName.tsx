import { useSite } from "../app/site";

// SiteName is the logo's text: the name of the site in two parts, the
// second in the site's color.
export function SiteName({ accentClass }: { accentClass?: string }) {
  const { look } = useSite();
  return (
    <span>
      {look.nameFirst}
      {look.nameSecond && <span className={accentClass}>{look.nameSecond}</span>}
    </span>
  );
}
