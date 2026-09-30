import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Configuration } from "./config.ts";

export function cloudflareAccess(config: Configuration, keys?: JWTVerifyGetKey) {
  if (!config.CF_ACCESS_TEAM_DOMAIN || !config.CF_ACCESS_AUD) {
    throw new Error("Cloudflare Access configuration is required");
  }
  const issuer = new URL(config.CF_ACCESS_TEAM_DOMAIN).origin;
  const audience = config.CF_ACCESS_AUD;
  const jwks = keys ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  return createMiddleware(async (context, next) => {
    const token = context.req.header("Cf-Access-Jwt-Assertion");
    if (!token)
      return context.json(
        { error: "Cloudflare Accessの認証が必要です。ページを再読み込みしてください。" },
        401,
      );
    try {
      await jwtVerify(token, jwks, {
        issuer,
        audience,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "sub"],
      });
    } catch {
      return context.json(
        { error: "Cloudflare Accessの認証を確認できません。ページを再読み込みしてください。" },
        401,
      );
    }
    await next();
  });
}
