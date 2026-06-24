function normOrg(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function inferNctRelationForCompany(
  company: string,
  leadSponsor: string,
  collaborators: string,
): string {
  const c = normOrg(company);
  if (!c) return "";
  const lead = normOrg(leadSponsor);
  if (lead && (lead.includes(c) || c.includes(lead))) return "direct sponsor";
  for (const part of collaborators.split("|")) {
    const p = normOrg(part.trim());
    if (p && (p.includes(c) || c.includes(p))) return "collaborator";
  }
  return "";
}
