import { IsString } from 'class-validator';

export class AdminRefreshTokenDto {
  @IsString()
  refreshToken: string;
}
