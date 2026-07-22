import type { AnchorHTMLAttributes, ReactNode } from "react";

export function AppLink({
  href, children, ...rest
}: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  );
}
