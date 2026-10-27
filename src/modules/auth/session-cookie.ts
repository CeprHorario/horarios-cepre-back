import type { Request, Response } from 'express';

export const sessionCookieName = (production: boolean) =>
  production ? '__Host-cepr-session' : 'cepr-session';

export function sessionCookieToken(
  request: Request,
  production = process.env.NODE_ENV === 'production',
): string | null {
  const names = [sessionCookieName(production)];
  const values = (request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => names.some((name) => part.startsWith(`${name}=`)));
  if (values.length !== 1) return null;
  try {
    return decodeURIComponent(values[0].slice(values[0].indexOf('=') + 1));
  } catch {
    return null;
  }
}

export function setSessionCookie(
  response: Response,
  token: string,
  production: boolean,
  seconds: number,
  sameSite: 'lax' | 'none' = 'lax',
) {
  response.cookie(sessionCookieName(production), token, {
    httpOnly: true,
    secure: production,
    sameSite,
    path: '/',
    maxAge: seconds * 1000,
  });
}

export function clearSessionCookie(
  response: Response,
  production: boolean,
  sameSite: 'lax' | 'none' = 'lax',
) {
  response.clearCookie(sessionCookieName(production), {
    httpOnly: true,
    secure: production,
    sameSite,
    path: '/',
  });
}
