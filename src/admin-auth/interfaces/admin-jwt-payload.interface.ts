export interface AdminAccessTokenPayload {
  sub: string;
}

export interface AdminRefreshTokenPayload {
  sub: string;
  jti: string;
}
