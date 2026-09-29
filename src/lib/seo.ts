/** schema.org BreadcrumbList for a page. */
export function breadcrumbLd(site: URL | undefined, crumbs: { href: string; label: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ href: '/', label: 'Home' }, ...crumbs].map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.label,
      item: new URL(c.href, site).toString(),
    })),
  };
}
