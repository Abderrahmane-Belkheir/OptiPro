export interface SocialLink {
  label: string;
  url: string;
}

/** Comes from the backend's `/api/infos` response — resolved from the requesting Host header to a tenant. */
export interface SiteInfo {
  /** The tenant's display name, e.g. for the navbar/footer/page title. */
  name: string;
  social: SocialLink[];
  contact: {
    address: string;
    phone: string;
    email: string;
  };
}
