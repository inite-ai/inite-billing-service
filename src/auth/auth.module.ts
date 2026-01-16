import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ServiceAuthGuard } from './guards/service-auth.guard';
import { JwtOrServiceGuard } from './guards/jwt-or-service.guard';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
  ],
  providers: [JwtStrategy, JwtAuthGuard, ServiceAuthGuard, JwtOrServiceGuard],
  exports: [JwtAuthGuard, ServiceAuthGuard, JwtOrServiceGuard],
})
export class AuthModule {}

