"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import type { ReactNode } from "react";

/**
 * A link that admits it is working.
 *
 * Every page here is rendered on the server and checks the session before a
 * single pixel changes, so clicking one of these is a moment of nothing: the
 * page you are on stays exactly as it was, and then the next one replaces it.
 * On a slow connection that is a dead click, and the honest reaction to a dead
 * click is to press it again.
 *
 * useLinkStatus is Next's own answer and it is scoped to the link that was
 * pressed, which is the part that matters. A bar across the top of the page
 * says something is happening; a mark on the link says which thing, so somebody
 * who clicked Domains and is looking at Domains knows the click landed.
 *
 * The indicator waits a moment before appearing. A navigation that resolves in
 * eighty milliseconds does not need announcing, and a spinner that flashes on
 * every click is worse than no spinner at all.
 */
function Pending() {
  const { pending } = useLinkStatus();
  return pending ? <span className="nav-pending" aria-hidden /> : null;
}

export default function NavLink({
  href,
  className,
  children,
  title,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <Link href={href} className={className} title={title}>
      {children}
      <Pending />
    </Link>
  );
}
