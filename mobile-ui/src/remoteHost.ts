/** URL VPS predefinito — allineato a desktop-ui/.env.remote.example */
export const DEFAULT_VPS_HOST = (
  import.meta.env.VITE_DEFAULT_REMOTE_HOST?.trim() || "http://91.99.15.48:8765"
).replace(/\/$/, "");

export function getDefaultApiBase(): string {
  const env = import.meta.env.VITE_API_BASE?.trim();
  if (env !== undefined && env !== "") return env.replace(/\/$/, "");
  return DEFAULT_VPS_HOST;
}
